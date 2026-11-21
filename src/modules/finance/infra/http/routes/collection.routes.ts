import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  GetAppointmentCollections, RecordAppointmentReceipts, RefundAppointmentReceipt,
  SettleAppointmentCommission, collectionErrors,
} from "../../../application/collections.use-cases.js";
import { CollectionsError, PAYMENT_METHODS } from "../../../domain/collections.js";
import { listCashMovements } from "../../database/repositories/cash-movements.js";
import { DrizzleCollectionsRepository } from "../../database/repositories/drizzle-collections.repository.js";

const params = z.object({ id: z.uuid() });
const amountInCents = z.number().int().positive().max(2147483647);
const writeFields = { effectiveOn: z.iso.date(), requestKey: z.uuid() };
const receiptBody = z.object({
  ...writeFields,
  appointmentId: z.uuid(),
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amountInCents })).min(1).max(2),
});
const refundBody = z.object({ ...writeFields, amountInCents, reason: z.string().trim().max(500) });
const filters = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  appointmentId: z.uuid().optional(),
  collaboratorId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
});

export async function collectionRoutes(app: FastifyInstance) {
  const repository = new DrizzleCollectionsRepository();
  const detail = new GetAppointmentCollections(repository);
  const record = new RecordAppointmentReceipts(repository);
  const refund = new RefundAppointmentReceipt(repository);
  const settle = new SettleAppointmentCommission(repository);
  const policy = { preHandler: [authenticate, authorizeRoles("OWNER")], schema: {
    tags: ["Finance (Owner)"], security: [{ bearerAuth: [] }],
  } };

  app.get("/finance/cash-movements", policy, async (request) => {
    if (!request.actor || request.actor.role !== "OWNER") throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    const filter = filters.omit({ appointmentId: true }).parse(request.query ?? {});
    if (filter.from && filter.to && filter.from > filter.to) throw new CollectionsError("VALIDATION", collectionErrors.date);
    return listCashMovements(request.actor.companyId, filter);
  });

  app.get("/finance/receipts", policy, async (request) => {
    if (request.actor?.role !== "OWNER") throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    const filter = filters.parse(request.query);
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new CollectionsError("VALIDATION", collectionErrors.date);
    }
    return repository.list(request.actor.companyId, filter);
  });

  app.get("/finance/appointments/:id", policy, async (request) => {
    if (!request.actor) throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    return detail.execute(request.actor, params.parse(request.params).id);
  });

  app.post("/finance/receipts", policy, async (request, reply) => {
    if (!request.actor) throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    const items = await record.execute(request.actor, receiptBody.parse(request.body));
    return reply.status(201).send({ items });
  });

  app.post("/finance/receipts/:id/refunds", policy, async (request, reply) => {
    if (!request.actor) throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    const items = await refund.execute(request.actor, params.parse(request.params).id, refundBody.parse(request.body));
    return reply.status(201).send({ items });
  });

  app.post("/finance/appointments/:id/commission-settlement", policy, async (request) => {
    if (!request.actor) throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
    return settle.execute(request.actor, params.parse(request.params).id);
  });
}
