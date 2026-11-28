
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

const mercadoPagoId = z.union([z.string().regex(/^[a-z0-9]{1,160}$/i), z.number().int().positive()]).transform(String);
const mercadoPagoNotification = z.object({ type: z.string(), data: z.object({ id: mercadoPagoId }).optional() });
const mercadoPagoQuery = z.object({ "data.id": mercadoPagoId, companyId: z.uuid().optional() });

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

const asaasSubaccountBody = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.email().max(200),
  cpfCnpj: z.string().trim().transform((value) => value.replace(/\D/g, "")).refine(
    (digits) => digits.length === 11 || digits.length === 14,
    "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.",
  ),
  mobilePhone: z.string().trim().transform((value) => value.replace(/\D/g, "")).refine(
    (digits) => digits.length >= 10 && digits.length <= 15,
    "Informe um celular válido com DDD.",
  ),
  incomeValue: z.coerce.number().positive().max(100_000_000),
  address: z.string().trim().max(160).optional(),
  addressNumber: z.string().trim().max(40).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

function frontendSettingsPaymentRedirect(params: Record<string, string>) {
  const base = (process.env.FRONTEND_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  const query = new URLSearchParams({ tab: "payments", ...params });
  return `${base}/owner/settings?${query.toString()}`;
}

export async function paymentRoutes(app: FastifyInstance, options?: { repository?: PaymentsRepository }) {
  const repository = options?.repository ?? new PaymentsRepository();
  const owner = { preHandler: [authenticate, authorizeRoles("OWNER")] };
  const auth = { preHandler: [authenticate] };

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

  app.get("/payments/connection-status", {
    ...auth,
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Get safe payment connection status for the authenticated tenant without exposing credentials",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["provider", "connected", "accountLabel", "walletId", "mpUserId", "depositEnabled", "depositPercentage", "autoRefundHours", "capabilities"],
          properties: {
            provider: { type: "string", enum: [...paymentProviders] },
            connected: { type: "boolean" },
            accountLabel: { type: ["string", "null"] },
            walletId: { type: ["string", "null"] },
            mpUserId: { type: ["string", "null"] },
            depositEnabled: { type: "boolean" },
            depositPercentage: { type: "integer" },
            autoRefundHours: { type: "integer" },
            capabilities: {
              type: "object",
              required: ["mercadoPagoOAuthAvailable", "asaasExpressAvailable"],
              properties: {
                mercadoPagoOAuthAvailable: { type: "boolean" },
                asaasExpressAvailable: { type: "boolean" },
              },
            },
          },
        },
        401: { type: "object", properties: { message: { type: "string" } } },
      },
    },
  }, async (request) => repository.getConnectionStatus(request.actor!.companyId));

  app.get("/payments/oauth/mercadopago/authorize", {
    ...owner,
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Generate 1-click Mercado Pago OAuth authorization URL with signed 15-minute state",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["authorizationUrl"],
          properties: { authorizationUrl: { type: "string", format: "uri" } },
        },
        503: {
          type: "object",
          properties: { code: { type: "string" }, message: { type: "string" } },
        },
      },
    },
  }, async (request) => {
    const actor = request.actor!;
    const userId = actor.role === "OWNER" ? actor.userId : actor.collaboratorId;
    return repository.createMercadoPagoAuthorizeUrl(actor.companyId, userId);
  });

  app.get("/payments/oauth/mercadopago/callback", {
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Public Mercado Pago OAuth callback that exchanges code for tokens and redirects back to settings",
      querystring: {
        type: "object",
        properties: {
          code: { type: "string" },
          state: { type: "string" },
          error: { type: "string" },
          error_description: { type: "string" },
        },
      },
      response: {
        302: {
          type: "null",
          description: "Redirects to frontend /owner/settings?tab=payments&oauth=success|error",
        },
      },
    },
  }, async (request, reply) => {
    const query = z.object({
      code: z.string().trim().min(1).optional(),
      state: z.string().trim().min(1).optional(),
      error: z.string().trim().optional(),
    }).parse(request.query);

    if (query.error || !query.code || !query.state) {
      const reason = query.error || "missing_oauth_params";
      return reply.redirect(frontendSettingsPaymentRedirect({ oauth: "error", reason }));
    }

    try {
      await repository.completeMercadoPagoOAuth({ code: query.code, state: query.state });
      return reply.redirect(frontendSettingsPaymentRedirect({ oauth: "success" }));
    } catch (error) {
      const reason = error instanceof PaymentError && error.reasonCode ? error.reasonCode : "oauth_exchange_failed";
      return reply.redirect(frontendSettingsPaymentRedirect({ oauth: "error", reason }));
    }
  });

  app.post("/payments/oauth/mercadopago/disconnect", {
    ...owner,
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Disconnect Mercado Pago OAuth credentials and disable provider if active",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          required: ["disconnected", "provider"],
          properties: {
            disconnected: { type: "boolean" },
            provider: { type: "string", enum: [...paymentProviders] },
          },
        },
      },
    },
  }, async (request) => repository.disconnectMercadoPago(request.actor!.companyId));

  app.post("/payments/onboarding/asaas/subaccount", {
    ...owner,
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Create an express Asaas subaccount using the platform master API key",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["name", "email", "cpfCnpj", "mobilePhone", "incomeValue"],
        properties: {
          name: { type: "string", minLength: 2, maxLength: 160 },
          email: { type: "string", format: "email", maxLength: 200 },
          cpfCnpj: { type: "string", minLength: 11, maxLength: 18 },
          mobilePhone: { type: "string", minLength: 10, maxLength: 20 },
          incomeValue: { type: "number", exclusiveMinimum: 0 },
          address: { type: "string", maxLength: 160 },
          addressNumber: { type: "string", maxLength: 40 },
          postalCode: { type: "string", maxLength: 20 },
        },
      },
      response: {
        201: {
          type: "object",
          required: ["provider", "connected", "accountLabel", "walletId"],
          properties: {
            provider: { type: "string", enum: ["ASAAS"] },
            connected: { type: "boolean" },
            accountLabel: { type: "string" },
            walletId: { type: "string" },
          },
        },
        400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        502: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        503: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const payload = asaasSubaccountBody.parse(request.body);
    const result = await repository.createAsaasExpressSubaccount(request.actor!.companyId, payload);
    return reply.code(201).send(result);
  });

  app.post("/payments/onboarding/asaas/connect-existing", {
    ...owner,
    schema: {
      tags: ["Payments Onboarding"],
      summary: "Connect an existing Asaas account using only the API Key (validates via /v3/myAccount and auto-registers webhook)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["apiKey"],
        properties: {
          apiKey: { type: "string", minLength: 12, maxLength: 1000 },
          staticPixKey: { type: ["string", "null"], maxLength: 77 },
        },
      },
      response: {
        200: {
          type: "object",
          required: ["provider", "connected", "accountLabel", "walletId"],
          properties: {
            provider: { type: "string", enum: ["ASAAS"] },
            connected: { type: "boolean" },
            accountLabel: { type: "string" },
            walletId: { type: ["string", "null"] },
          },
        },
        400: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
        422: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } },
      },
    },
  }, async (request) => {
    const payload = z.object({
      apiKey: z.string().trim().min(12).max(1000),
      staticPixKey: z.string().trim().regex(/^[!-~]{1,77}$/).nullable().optional(),
    }).parse(request.body);
    return repository.connectExistingAsaas(request.actor!.companyId, payload);
  });

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

  const handleAsaasWebhook = async (request: { body: unknown; headers: Record<string, unknown> }) => {
    const envelope = webhookEnvelope.parse(request.body);
    if (envelope.event !== "PAYMENT_RECEIVED" && envelope.event !== "PAYMENT_CONFIRMED") return { processed: false };
    const token = request.headers["asaas-access-token"];
    if (typeof token !== "string" || !token) throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    const payment = asaasPayment.safeParse(envelope.payment);
    if (!payment.success) return { processed: false };
    const data = payment.data;
    return repository.settleAsaas({
      eventId: envelope.id, externalId: data.id, externalSubscriptionId: data.subscription ?? undefined,
      staticQrCodeId: data.pixQrCodeId ?? undefined, reference: data.externalReference ?? undefined,
      amountCents: Math.round(data.value * 100), method: data.billingType,
      paidAt: eventTimestamp([data.confirmedDate, data.paymentDate, envelope.dateCreated]),
      dueDate: data.originalDueDate ?? data.dueDate,
    }, token);
  };

  app.post("/payments/webhooks/asaas", async (request) => handleAsaasWebhook(request));

  app.post("/webhooks/payments/:provider", async (request) => {
    const { provider } = z.object({ provider: z.string().toUpperCase() }).parse(request.params);
    if (provider === "MERCADO-PAGO") {
      const { type, data } = mercadoPagoNotification.parse(request.body);
      if (type !== "payment" && type !== "subscription_authorized_payment") return { processed: false };
      const { "data.id": resourceId, companyId } = mercadoPagoQuery.parse(request.query);
      const requestId = request.headers["x-request-id"];
      const signature = request.headers["x-signature"];
      if (typeof requestId !== "string" || !requestId || typeof signature !== "string" ||
        (data && data.id.toLowerCase() !== resourceId.toLowerCase())) {
        throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
      }
      return repository.settleMercadoPago(type, { resourceId, requestId, signature }, companyId);
    }
    if (provider !== "ASAAS") throw new PaymentError("Provedor de webhook inválido.", "NOT_FOUND", "PAYMENT_PROVIDER_NOT_FOUND");
    return handleAsaasWebhook(request);
  });
}
