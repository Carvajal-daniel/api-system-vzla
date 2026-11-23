import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import { ManageCommissionSettlements, ManageExpenses } from "../../../application/outflows.use-cases.js";
import { CollectionsError, PAYMENT_METHODS } from "../../../domain/collections.js";
import type { ExpenseEdit } from "../../../domain/outflows.js";
import { COMMISSION_DEDUCTION_CATEGORIES, EXPENSE_CATEGORIES, EXPENSE_STATUSES, EXPENSE_TYPES } from "../../../domain/outflows.js";
import { DrizzleOutflowsRepository } from "../../database/repositories/drizzle-outflows.repository.js";

const date = z.iso.date();
const money = z.number().int().positive().max(2147483647);
const optionalNotes = z.string().trim().max(1000).nullish().transform((value) => value || null);
const requestKey = z.uuid().nullish().transform((value) => value ?? null);
const payment = { paidOn: date, paymentMethod: z.enum(PAYMENT_METHODS) };
const filters = z.object({ from: date.optional(), to: date.optional(), collaboratorId: z.uuid().optional() });
const expenseFilters = filters.extend({ status: z.enum(EXPENSE_STATUSES).optional() });
const expenseInput = z.object({
  description: z.string().trim().min(1).max(240),
  category: z.enum(EXPENSE_CATEGORIES),
  expenseType: z.enum(EXPENSE_TYPES),
  amountCents: money.optional(),
  quantity: money.optional(),
  unitAmountCents: money.nullish(),
  dueDate: date,
  isRecurring: z.boolean().default(false),
  notes: optionalNotes,
  externalSourceType: z.string().trim().min(1).max(40).nullish().transform((value) => value ?? null),
  externalSourceId: z.string().trim().min(1).max(128).nullish().transform((value) => value ?? null),
  requestKey,
});
const expensePaymentFields = {
  paidOn: date.nullish(),
  paymentMethod: z.enum(PAYMENT_METHODS).nullish(),
  status: z.enum(["PENDING", "PAID"]).optional(),
};
const editableExpense = expenseInput.omit({ externalSourceType: true, externalSourceId: true, requestKey: true })
  .extend({ notes: z.string().trim().max(1000).nullable() });
const expenseEdit = editableExpense.partial().extend(expensePaymentFields);
const expenseImport = editableExpense.extend({
  ...expensePaymentFields, notes: optionalNotes, isRecurring: z.boolean().default(false),
}).transform((row) => ({ ...row, externalSourceType: null, externalSourceId: null, requestKey: null }));
const deductionInput = expenseInput.pick({
  description: true, quantity: true, amountCents: true, unitAmountCents: true,
  notes: true, externalSourceType: true, externalSourceId: true, requestKey: true,
}).extend({
  collaboratorId: z.uuid(),
  category: z.enum(COMMISSION_DEDUCTION_CATEGORIES),
  deductedAt: date,
  quantity: money.default(1),
});
const settlementInput = z.object({
  ...payment,
  collaboratorId: z.uuid(),
  periodStart: date,
  periodEnd: date,
  expectedAmountCents: z.number().int().nonnegative().max(2147483647).nullish().transform((value) => value ?? null),
  requestKey,
  notes: optionalNotes,
});

function actor(request: FastifyRequest) {
  if (!request.actor) throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
  return request.actor;
}

export async function outflowRoutes(app: FastifyInstance) {
  const repository = new DrizzleOutflowsRepository();
  const expenses = new ManageExpenses(repository);
  const settlements = new ManageCommissionSettlements(repository);
  const policy = { preHandler: [authenticate, authorizeRoles("OWNER")], schema: {
    tags: ["Finance (Owner)"], security: [{ bearerAuth: [] }],
  } };
  const id = z.object({ id: z.uuid() });

  app.get("/finance/expenses", policy, async (request) => ({
    items: await expenses.list(actor(request), expenseFilters.parse(request.query ?? {})),
  }));
  app.post("/finance/expenses", policy, async (request, reply) =>
    reply.status(201).send(await expenses.create(actor(request), expenseInput.parse(request.body))));
  app.post("/finance/expenses/import", policy, async (request, reply) => {
    const input = z.object({ requestKey: z.uuid(), rows: z.array(expenseImport).min(1).max(500) }).parse(request.body);
    return reply.status(201).send(await expenses.import(actor(request), input.requestKey, input.rows));
  });
  app.patch("/finance/expenses/:id", policy, async (request) => {
    const parsed = expenseEdit.parse(request.body);
    const changes: ExpenseEdit = Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined));
    return expenses.edit(actor(request), id.parse(request.params).id, changes);
  });
  app.patch("/finance/expenses/:id/pay", policy, async (request) =>
    expenses.pay(actor(request), id.parse(request.params).id, z.object(payment).parse(request.body)));
  app.delete("/finance/expenses/:id", policy, async (request, reply) => {
    await expenses.remove(actor(request), id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.get("/finance/commission-deductions", policy, async (request) => ({
    items: await settlements.listDeductions(actor(request), filters.parse(request.query ?? {})),
  }));
  app.post("/finance/commission-deductions", policy, async (request, reply) =>
    reply.status(201).send(await settlements.createDeduction(actor(request), deductionInput.parse(request.body))));
  app.delete("/finance/commission-deductions/:id", policy, async (request, reply) => {
    await settlements.deleteDeduction(actor(request), id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.get("/finance/commissions", policy, async (request) =>
    settlements.list(actor(request), filters.parse(request.query ?? {})));
  app.post("/finance/commission-settlements", policy, async (request, reply) =>
    reply.status(201).send(await settlements.record(actor(request), settlementInput.parse(request.body))));

  // Endpoints detalhados por profissional (Bloco 3)
  const collaboratorParams = z.object({ collaboratorId: z.uuid() });
  const collaboratorSettleBody = z.object({
    ...payment,
    periodStart: date,
    periodEnd: date,
    expectedAmountCents: z.number().int().nonnegative().max(2147483647).nullish().transform((value) => value ?? null),
    requestKey,
    notes: optionalNotes,
  });

  app.get("/v1/commissions/collaborators/:collaboratorId", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Get detailed commission report (pending services/products, deductions and settled history) for a collaborator",
    },
  }, async (request) => {
    const { collaboratorId } = collaboratorParams.parse(request.params);
    return settlements.detail(actor(request), collaboratorId, filters.parse(request.query ?? {}));
  });

  app.post("/v1/commissions/collaborators/:collaboratorId/settle", {
    ...policy,
    schema: {
      ...policy.schema,
      summary: "Settle all pending commissions for a collaborator in the period and record financial outflow",
    },
  }, async (request, reply) => {
    const { collaboratorId } = collaboratorParams.parse(request.params);
    const body = collaboratorSettleBody.parse(request.body);
    return reply.status(201).send(
      await settlements.record(actor(request), { ...body, collaboratorId }),
    );
  });
}
