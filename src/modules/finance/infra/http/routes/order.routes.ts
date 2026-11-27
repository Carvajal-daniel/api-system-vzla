import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  CreateFinanceOrder,
  GetFinanceOrder,
  ListFinanceOrders,
  ReopenFinanceOrder,
  UpdateFinanceOrder,
} from "../../../application/orders.use-cases.js";
import { CollectionsError, PAYMENT_METHODS } from "../../../domain/collections.js";
import { ORDER_ITEM_TYPES, ORDER_STATUSES } from "../../../domain/orders.js";
import { DrizzleOrdersRepository } from "../../database/repositories/drizzle-orders.repository.js";
import { PostVisitSurveyUseCase } from "../../../../operations/application/post-visit-survey.use-case.js";
import { DrizzleOperationsRepository } from "../../../../operations/infra/database/repositories/drizzle-operations.repository.js";
import { WhatsAppOperationsNotificationAdapter } from "../../../../operations/infra/notifications/whatsapp-operations-notification.adapter.js";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.length > 0 ? v : null));

const optionalUuid = z
  .union([z.uuid(), z.literal(""), z.null(), z.undefined()])
  .transform((v) => (v && v.length > 0 ? v : null));

const orderItemSchema = z.object({
  itemType: z.enum(ORDER_ITEM_TYPES),
  referenceId: optionalUuid,
  name: z.string().trim().min(1).max(240),
  collaboratorId: optionalUuid,
  quantity: z.number().int().positive().max(10000),
  unitPriceCents: z.number().int().min(0).max(2147483647),
  commissionPercentage: z.number().int().min(0).max(100).default(0),
});

const orderPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountCents: z.number().int().positive().max(2147483647),
});

const createOrderBody = z.object({
  code: z.string().trim().min(1).max(40).optional(),
  appointmentId: optionalUuid,
  clientName: optionalText(160),
  clientPhone: optionalText(40),
  clientDocument: optionalText(40),
  orderDate: z.iso.date(),
  status: z.enum(ORDER_STATUSES).default("OPEN"),
  discountCents: z.number().int().min(0).max(2147483647).default(0),
  notes: optionalText(1000),
  requestKey: z.uuid(),
  items: z.array(orderItemSchema).min(1).max(100),
  payments: z.array(orderPaymentSchema).max(20).default([]),
});

const updateOrderBody = z.object({
  clientName: optionalText(160),
  clientPhone: optionalText(40),
  clientDocument: optionalText(40),
  orderDate: z.iso.date(),
  status: z.enum(ORDER_STATUSES).default("OPEN"),
  discountCents: z.number().int().min(0).max(2147483647).default(0),
  notes: optionalText(1000),
  items: z.array(orderItemSchema).min(1).max(100),
  payments: z.array(orderPaymentSchema).max(20).default([]),
});

const reopenOrderBody = z.object({
  pin: z.string().trim().regex(/^\d{4,6}$/, "OWNER_PIN_INVALID_FORMAT"),
  reason: z.string().trim().min(3, "FINANCE_REOPEN_REASON_REQUIRED").max(500),
});

const orderIdParams = z.object({
  orderId: z.uuid(),
});

const listOrdersQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

function requireActor(request: FastifyRequest) {
  if (!request.actor) {
    throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
  }
  return request.actor;
}

export async function orderRoutes(app: FastifyInstance) {
  const repository = new DrizzleOrdersRepository();
  const postVisitSurveyHook = new PostVisitSurveyUseCase(
    new DrizzleOperationsRepository(),
    new WhatsAppOperationsNotificationAdapter(),
  );
  const createOrder = new CreateFinanceOrder(repository, postVisitSurveyHook);
  const listOrders = new ListFinanceOrders(repository);
  const getOrder = new GetFinanceOrder(repository);
  const updateOrder = new UpdateFinanceOrder(repository, postVisitSurveyHook);
  const reopenOrder = new ReopenFinanceOrder(repository);

  const policy = {
    preHandler: [authenticate, authorizeRoles("OWNER")],
    schema: {
      tags: ["Finance Orders (Owner)"],
      security: [{ bearerAuth: [] }],
    },
  };

  app.get("/finance/orders", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "List saved orders (comandas) for the period",
    },
  }, async (request) => {
    const filters = listOrdersQuery.parse(request.query ?? {});
    const items = await listOrders.execute(requireActor(request), filters);
    return { items };
  });

  app.get("/finance/orders/:orderId", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Get details of a single saved order (comanda)",
      params: {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string", format: "uuid" } },
      },
    },
  }, async (request) => {
    const { orderId } = orderIdParams.parse(request.params);
    return getOrder.execute(requireActor(request), orderId);
  });

  app.post("/finance/orders", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Create order (comanda) with optional client, payments and automatic SALE_OUT stock deduction",
    },
  }, async (request, reply) => {
    const body = createOrderBody.parse(request.body);
    const created = await createOrder.execute(requireActor(request), body);
    return reply.status(201).send(created);
  });

  app.patch("/finance/orders/:orderId", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Update an OPEN order (comanda). Returns 409 if CLOSED until reopened with owner PIN",
      params: {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string", format: "uuid" } },
      },
    },
  }, async (request) => {
    const { orderId } = orderIdParams.parse(request.params);
    const body = updateOrderBody.parse(request.body);
    return updateOrder.execute(requireActor(request), orderId, body);
  });

  app.post("/finance/orders/:orderId/reopen", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Reopen a CLOSED order (comanda) using the owner PIN and mandatory audit reason",
      params: {
        type: "object",
        required: ["orderId"],
        properties: { orderId: { type: "string", format: "uuid" } },
      },
      body: {
        type: "object",
        required: ["pin", "reason"],
        properties: {
          pin: { type: "string", pattern: "^[0-9]{4,6}$" },
          reason: { type: "string", minLength: 3, maxLength: 500 },
        },
      },
    },
  }, async (request) => {
    const { orderId } = orderIdParams.parse(request.params);
    const body = reopenOrderBody.parse(request.body);
    return reopenOrder.execute(requireActor(request), orderId, body);
  });
}
