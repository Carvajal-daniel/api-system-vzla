import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { CollectionsError, PAYMENT_METHODS } from "../../../finance/domain/collections.js";
import { ManageInventory } from "../../application/manage-inventory.js";
import type { EditItem } from "../../domain/inventory.js";
import { inventoryCategories, inventoryUnits, movementTypes } from "../../domain/inventory.js";
import { DrizzleInventoryRepository } from "../database/drizzle-inventory.repository.js";

const quantity = z.number().int().positive().max(2147483647);
const nonnegative = z.number().int().nonnegative().max(2147483647);
const page = z.coerce.number().int().min(1).max(1000000).default(1);
const date = z.iso.date();
const id = z.object({ id: z.uuid() });
const requestKey = z.uuid();
const text = (length: number) => z.string().trim().max(length).nullish().transform((value) => value || null);
const itemInput = z.object({
  name: z.string().trim().min(1).max(240), sku: text(80), category: z.enum(inventoryCategories),
  unit: z.enum(inventoryUnits), minStock: nonnegative.default(0), costPriceCents: nonnegative,
  salePriceCents: nonnegative.nullish().transform((value) => value ?? null), initialStock: nonnegative.default(0),
});
const itemChanges = itemInput.omit({ initialStock: true }).partial().extend({
  sku: z.string().trim().min(1).max(80).nullable().optional(),
  salePriceCents: nonnegative.nullable().optional(), minStock: nonnegative.optional(), isActive: z.boolean().optional(),
});
const itemFilters = z.object({
  page, category: z.enum(inventoryCategories).optional(), lowStock: z.stringbool().optional(),
  search: z.string().trim().max(100).optional(),
});
const movementFilters = z.object({ itemId: z.uuid().optional(), from: date.optional(), to: date.optional(), page });
const movementInput = z.object({
  itemId: z.uuid(), movementType: z.enum(movementTypes), quantity, unitCostCents: nonnegative.optional(),
  unitSaleCents: nonnegative.optional(), collaboratorId: z.uuid().nullish().transform((value) => value ?? undefined), paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  direction: z.enum(["IN", "OUT"]).optional(), postExpense: z.boolean().default(false), notes: text(1000),
  occurredOn: date, requestKey,
});

function actor(request: FastifyRequest) {
  if (!request.actor) throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
  return request.actor;
}

export async function inventoryRoutes(app: FastifyInstance) {
  const inventory = new ManageInventory(new DrizzleInventoryRepository());
  const policy = { preHandler: [authenticate, authorizeRoles("OWNER")], schema: {
    tags: ["Inventory (Owner)"], security: [{ bearerAuth: [] }],
  } };
  app.get("/inventory/items", policy, (request) => inventory.items(actor(request), itemFilters.parse(request.query ?? {})));
  app.post("/inventory/items", policy, async (request, reply) =>
    reply.status(201).send(await inventory.create(actor(request), itemInput.parse(request.body))));
  app.post("/inventory/items/import", policy, async (request, reply) => {
    const body = z.object({ requestKey, rows: z.array(itemInput).min(1).max(500) }).parse(request.body);
    return reply.status(201).send(await inventory.import(actor(request), body.requestKey, body.rows));
  });
  app.patch("/inventory/items/:id", policy, (request) => {
    const changes: EditItem = Object.fromEntries(Object.entries(itemChanges.parse(request.body)).filter(([, value]) => value !== undefined));
    return inventory.edit(actor(request), id.parse(request.params).id, changes);
  });
  app.delete("/inventory/items/:id", policy, async (request, reply) => {
    await inventory.archive(actor(request), id.parse(request.params).id);
    return reply.status(204).send();
  });
  app.get("/inventory/movements", policy, (request) => inventory.movements(actor(request), movementFilters.parse(request.query ?? {})));
  app.post("/inventory/movements", policy, async (request, reply) =>
    reply.status(201).send(await inventory.record(actor(request), movementInput.parse(request.body))));
  app.post("/inventory/movements/:id/reverse", policy, async (request, reply) =>
    reply.status(201).send(await inventory.reverse(actor(request), id.parse(request.params).id)));
  app.get("/inventory/summary", policy, (request) => inventory.summary(actor(request)));
}
