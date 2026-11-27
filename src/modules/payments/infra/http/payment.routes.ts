
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { chargeReferences, paymentProviders, subscriptionMethods, subscriptionStatuses } from "../../domain/payment-gateway.js";
import { PaymentError } from "../../domain/payment-policy.js";
import { PaymentsRepository } from "../database/payments.repository.js";

const cents = z.number().int().positive().max(2147483647);
const id = z.object({ id: z.uuid() });
const document = z.string().regex(/^\d{11}$|^\d{14}$/).optional();

const planFields = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  priceCents: cents,
  billingCycle: z.literal("MONTHLY"),
  includedServiceIds: z.array(z.uuid()).max(100).transform((ids) => [...new Set(ids)]),
  allowedDaysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).transform((days) => [...new Set(days)].sort()).nullable(),
  gracePeriodDays: z.number().int().min(0).max(365),
  maxMonthlyUses: z.number().int().min(0).max(10000).nullable(),
  active: z.boolean(),
});

const newPlan = planFields.extend({
  billingCycle: planFields.shape.billingCycle.default("MONTHLY"),
  includedServiceIds: planFields.shape.includedServiceIds.default([]),
  allowedDaysOfWeek: planFields.shape.allowedDaysOfWeek.default(null),
  gracePeriodDays: planFields.shape.gracePeriodDays.default(3),
  maxMonthlyUses: planFields.shape.maxMonthlyUses.default(null),
  active: planFields.shape.active.default(true),
});

const webhookEnvelope = z.object({ event: z.string(), id: z.string().min(1).max(160), dateCreated: z.string().optional(), payment: z.unknown() });
const asaasPayment = z.object({
  id: z.string().min(1).max(160),
  subscription: z.string().nullish(),
  pixQrCodeId: z.string().nullish(),
  externalReference: z.string().nullish(),
  billingType: z.enum(subscriptionMethods),
  value: z.number().positive().max(21474836.47),
  confirmedDate: z.string().nullish(),
  paymentDate: z.string().nullish(),
  dueDate: z.iso.date().optional(),
  originalDueDate: z.iso.date().optional(),
});

function eventTimestamp(values: (string | null | undefined)[]) {
  for (const value of values) {
    if (!value || value.length < 19) continue;
    const iso = value.replace(" ", "T");
    const timestamp = new Date(iso.length === 19 ? iso + "-03:00" : iso);
    if (Number.isFinite(timestamp.getTime())) return timestamp;
  }
  throw new PaymentError("O evento não contém horário de confirmação.", "VALIDATION", "PAYMENT_TIMESTAMP_REQUIRED");
}

export async function paymentRoutes(app: FastifyInstance) {
  const repository = new PaymentsRepository();
  const owner = { preHandler: [authenticate, authorizeRoles("OWNER")] };

  app.get("/subscription-plans", owner, async (request) => repository.listPlans(request.actor!.companyId));
  app.post("/subscription-plans", owner, async (request, reply) =>
    reply.code(201).send(await repository.writePlan(request.actor!.companyId, newPlan.parse(request.body))));
  app.patch("/subscription-plans/:id", owner, async (request) => {
    const payload = planFields.partial().refine((changes) => Object.keys(changes).length > 0).parse(request.body);
    return repository.writePlan(request.actor!.companyId, payload, id.parse(request.params).id);
  });

  app.get("/client-subscriptions", owner, async (request) => {
    const query = z.object({ status: z.enum(subscriptionStatuses).optional() }).parse(request.query);
    const rows = await repository.listSubscriptions(request.actor!.companyId, query.status);
    return rows.map(({ subscription, clientName, planName }) => ({ ...subscription, clientName, planName }));
  });
  app.post("/client-subscriptions", owner, async (request, reply) => {
    const payload = z.object({
      clientId: z.uuid(), planId: z.uuid(), paymentMethod: z.enum(subscriptionMethods),
      document, cardToken: z.string().trim().min(1).max(300).optional(),
    }).parse(request.body);
    return reply.code(201).send(await repository.enroll(request.actor!.companyId, { ...payload, remoteIp: request.ip }));
  });

  app.get("/payments/config", owner, async (request) => repository.getConfig(request.actor!.companyId));
  app.put("/payments/config", owner, async (request) => repository.configure(request.actor!.companyId, z.object({
    paymentProvider: z.enum(paymentProviders),
    providerApiKey: z.string().trim().min(12).max(1000).optional(),
    webhookToken: z.string().trim().min(32).max(256).optional(),
    staticPixKey: z.string().trim().regex(/^[!-~]{1,77}$/).nullable().optional(),
  }).parse(request.body)));

  app.post("/payments/pix", owner, async (request, reply) => {
    const payload = z.object({
      referenceType: z.enum(chargeReferences), referenceId: z.uuid(), clientId: z.uuid(),
      amountCents: cents.optional(), document,
    }).parse(request.body);
    const { externalId: _, ...charge } = await repository.createPix(request.actor!.companyId, payload);
    return reply.code(201).send(charge);
  });
  app.get("/payments/:id/status", owner, async (request) => repository.status(request.actor!.companyId, id.parse(request.params).id));

  if (["development", "test"].includes(process.env.NODE_ENV ?? "development")) {
    app.post("/payments/:id/simulate-confirmation", owner, async (request) =>
      repository.simulate(request.actor!.companyId, id.parse(request.params).id));
  }

  app.post("/webhooks/payments/:provider", async (request) => {
    const { provider } = z.object({ provider: z.string().toUpperCase() }).parse(request.params);
    if (provider !== "ASAAS") throw new PaymentError("Provedor de webhook inválido.", "NOT_FOUND", "PAYMENT_PROVIDER_NOT_FOUND");
    const envelope = webhookEnvelope.parse(request.body);
    if (envelope.event !== "PAYMENT_RECEIVED" && envelope.event !== "PAYMENT_CONFIRMED") return { processed: false };
    const token = request.headers["asaas-access-token"];
    if (typeof token !== "string" || !token) throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    const payment = asaasPayment.safeParse(envelope.payment);
    if (!payment.success) return { processed: false };
    const data = payment.data;
    return repository.settle("ASAAS", {
      eventId: envelope.id, externalId: data.id, externalSubscriptionId: data.subscription ?? undefined,
      staticQrCodeId: data.pixQrCodeId ?? undefined, reference: data.externalReference ?? undefined,
      amountCents: Math.round(data.value * 100), method: data.billingType,
      paidAt: eventTimestamp([data.confirmedDate, data.paymentDate, envelope.dateCreated]),
      dueDate: data.originalDueDate ?? data.dueDate,
    }, token);
  });
}
