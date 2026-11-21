import { and, asc, desc, eq, getTableColumns, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { importOnce } from "../../../../shared/database/import-once.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CollectionsError } from "../../../finance/domain/collections.js";
import { paymentInstant, type FinanceTransaction } from "../../../finance/infra/database/repositories/outflow-projections.js";
import { CommissionDeductionApplicationTable, CommissionDeductionTable, ExpenseTable } from "../../../finance/infra/database/schema/outflows-schema.js";
import type { InventoryRepository } from "../../application/manage-inventory.js";
import { inventorySource, type EditItem, type ItemFilters, type MovementFilters, type MovementInput, type NewItem } from "../../domain/inventory.js";
import { movementDay, saleAmount } from "./inventory-projections.js";
import { InventoryItemTable, InventoryMovementTable } from "./schema/inventory-schema.js";

const item = InventoryItemTable;
const movement = InventoryMovementTable;
const limit = 40;
const missing = () => new CollectionsError("NOT_FOUND", "INVENTORY_NOT_FOUND");
const conflict = (code: string) => new CollectionsError("CONFLICT", code);
const invalid = (code: string) => new CollectionsError("VALIDATION", code);
const intMax = 2147483647;

async function companyPolicy(companyId: string, tx?: FinanceTransaction) {
  const query = (tx ?? db).select({
    timezone: CompanyTable.timezone, currency: CompanyTable.currency,
    today: sql<string>`to_char(now() at time zone ${CompanyTable.timezone}, 'YYYY-MM-DD')`,
  }).from(CompanyTable).where(eq(CompanyTable.id, companyId));
  const [company] = await (tx ? query.for("update") : query);
  if (!company) throw missing();
  return company;
}

async function assertSku(tx: FinanceTransaction, companyId: string, sku: string | null | undefined, skip?: string) {
  if (!sku) return;
  const [existing] = await tx.select({ id: item.id }).from(item).where(and(
    eq(item.companyId, companyId), sql`lower(${item.sku}) = lower(${sku})`, skip ? sql`${item.id} <> ${skip}` : undefined,
  ));
  if (existing) throw conflict("INVENTORY_DUPLICATE_SKU");
}

async function insertItem(tx: FinanceTransaction, companyId: string, input: NewItem, today: string, timezone: string) {
  const { initialStock, ...fields } = input;
  const total = initialStock * fields.costPriceCents;
  if (total > intMax) throw invalid("FINANCE_INVALID_AMOUNT");
  await assertSku(tx, companyId, fields.sku);
  const [created] = await tx.insert(item).values({ ...fields, companyId, currentStock: initialStock }).returning();
  if (initialStock > 0) await tx.insert(movement).values({
    companyId, itemId: created!.id, movementType: "ADJUSTMENT", quantity: initialStock, stockDelta: initialStock,
    unitCostCents: created!.costPriceCents, totalAmountCents: total, occurredAt: paymentInstant(today, timezone),
  });
  return created!;
}

function checkedStock(current: number, delta: number) {
  const stock = current + delta;
  if (stock < 0) throw conflict("INVENTORY_INSUFFICIENT_STOCK");
  if (stock > intMax) throw invalid("INVENTORY_INVALID_QUANTITY");
  return stock;
}

export class DrizzleInventoryRepository implements InventoryRepository {
  async listItems(companyId: string, filters: ItemFilters) {
    const search = filters.search ? "%" + filters.search.replace(/[\\%_]/g, "\\$&") + "%" : undefined;
    const rows = await db.select().from(item).where(and(
      eq(item.companyId, companyId), eq(item.isActive, true),
      filters.category ? eq(item.category, filters.category) : undefined,
      filters.lowStock ? lte(item.currentStock, item.minStock) : undefined,
      search ? or(ilike(item.name, search), ilike(item.sku, search)) : undefined,
    )).orderBy(asc(item.name), asc(item.id)).limit(limit + 1).offset((filters.page - 1) * limit);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  createItem(companyId: string, input: NewItem) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(companyId, tx);
      return insertItem(tx, companyId, input, today, timezone);
    });
  }

  editItem(companyId: string, id: string, changes: EditItem) {
    return db.transaction(async (tx) => {
      await companyPolicy(companyId, tx);
      await assertSku(tx, companyId, changes.sku, id);
      const [updated] = await tx.update(item).set({ ...changes, updatedAt: new Date() })
        .where(and(eq(item.companyId, companyId), eq(item.id, id))).returning();
      if (!updated) throw missing();
      return updated;
    });
  }

  async archiveItem(companyId: string, id: string) {
    await this.editItem(companyId, id, { isActive: false });
  }

  importItems(companyId: string, key: string, items: NewItem[]) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(companyId, tx);
      return importOnce(tx, companyId, "INVENTORY", key, items, async () => {
        for (const row of items) await insertItem(tx, companyId, row, today, timezone);
        return items.length;
      });
    });
  }

  async listMovements(companyId: string, filters: MovementFilters) {
    const { timezone } = await companyPolicy(companyId);
    const day = movementDay(timezone);
    const rows = await db.select({
      ...getTableColumns(movement), itemName: item.name, collaboratorName: CollaboratorTable.name,
      occurredOn: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
      reversed: sql<boolean>`exists (select 1 from inventory_movements reversal
        where reversal.company_id = ${movement.companyId} and reversal.reverses_movement_id = ${movement.id})`,
    }).from(movement).innerJoin(item, and(eq(item.id, movement.itemId), eq(item.companyId, movement.companyId)))
      .leftJoin(CollaboratorTable, and(eq(CollaboratorTable.id, movement.collaboratorId),
        eq(CollaboratorTable.companyId, movement.companyId)))
      .where(and(eq(movement.companyId, companyId), filters.itemId ? eq(movement.itemId, filters.itemId) : undefined,
        filters.from ? gte(day, sql`${filters.from}::date`) : undefined,
        filters.to ? lte(day, sql`${filters.to}::date`) : undefined))
      .orderBy(desc(movement.occurredAt), desc(movement.createdAt), desc(movement.id))
      .limit(limit + 1).offset((filters.page - 1) * limit);
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async summary(companyId: string) {
    const { today, timezone, currency } = await companyPolicy(companyId);
    const day = movementDay(timezone);
    const [[stock], [monthly]] = await Promise.all([
      db.select({
        totalItems: sql<number>`count(*)`.mapWith(Number),
        stockCostCents: sql<number>`coalesce(sum(${item.currentStock}::bigint * ${item.costPriceCents}), 0)`.mapWith(Number),
        lowStockItems: sql<number>`count(*) filter (where ${item.currentStock} <= ${item.minStock})`.mapWith(Number),
      }).from(item).where(and(eq(item.companyId, companyId), eq(item.isActive, true))),
      db.select({
        salesCents: sql<number>`coalesce(sum(${saleAmount}) filter (where ${movement.movementType} = 'SALE_OUT'), 0)`.mapWith(Number),
        outgoingMovements: sql<number>`count(*) filter (where ${movement.stockDelta} < 0 and ${movement.reversesMovementId} is null
           and not exists (${sql`select 1 from inventory_movements reversal where reversal.company_id = ${movement.companyId}
             and reversal.reverses_movement_id = ${movement.id}`}))`.mapWith(Number),
      }).from(movement).where(and(eq(movement.companyId, companyId), gte(day, sql`${today.slice(0, 7) + "-01"}::date`),
        lte(day, sql`${today}::date`))),
    ]);
    return { ...stock, ...monthly, currency, today };
  }

  recordMovement(companyId: string, input: MovementInput) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(companyId, tx);
      const fingerprint = JSON.stringify(input);
      const [existing] = await tx.select().from(movement).where(and(eq(movement.companyId, companyId), eq(movement.requestKey, input.requestKey)));
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw conflict("FINANCE_IDEMPOTENCY_CONFLICT");
        return existing;
      }
      if (input.occurredOn > today) throw invalid("INVENTORY_INVALID_DATE");
      const itemScope = and(eq(item.companyId, companyId), eq(item.id, input.itemId));
      const [product] = await tx.select().from(item).where(itemScope);
      if (!product?.isActive) throw missing();
      const { movementType, quantity, notes, collaboratorId, paymentMethod, occurredOn } = input;
      const sale = movementType === "SALE_OUT";
      const purchase = movementType === "PURCHASE_IN";
      if (sale && product.category !== "RESALE_PRODUCT") throw invalid("INVENTORY_NOT_FOR_SALE");
      if (collaboratorId) {
        const [person] = await tx.select({ id: CollaboratorTable.id }).from(CollaboratorTable).where(and(
          eq(CollaboratorTable.companyId, companyId), eq(CollaboratorTable.id, collaboratorId), eq(CollaboratorTable.isActive, true),
        ));
        if (!person) throw missing();
      }
      const unitCostCents = input.unitCostCents ?? product.costPriceCents;
      const unitSaleCents = sale ? input.unitSaleCents ?? product.salePriceCents : null;
      const price = sale ? unitSaleCents ?? 0 : unitCostCents;
      const totalAmountCents = price * quantity;
      if (totalAmountCents > intMax || ((sale || collaboratorId || input.postExpense) && totalAmountCents <= 0)) {
        throw invalid("FINANCE_INVALID_AMOUNT");
      }
      const stockDelta = purchase || input.direction === "IN" ? quantity : -quantity;
      const currentStock = checkedStock(product.currentStock, stockDelta);
      const [created] = await tx.insert(movement).values({
        companyId, itemId: input.itemId, movementType, quantity, stockDelta, unitCostCents, unitSaleCents,
        totalAmountCents, collaboratorId, paymentMethod, notes, fingerprint, requestKey: input.requestKey,
        occurredAt: paymentInstant(occurredOn, timezone),
      }).returning();
      const source = { externalSourceType: inventorySource, externalSourceId: created!.id };
      let financeReferenceType: typeof movement.$inferSelect.financeReferenceType = null;
      let financeReferenceId: string | null = null;
      if (input.postExpense) {
        const [expense] = await tx.insert(ExpenseTable).values({
          ...source, companyId, description: product.name, category: "STOCK_PURCHASE", expenseType: "VARIABLE",
          quantity, unitAmountCents: price, amountCents: totalAmountCents, dueDate: occurredOn, notes,
        }).returning({ id: ExpenseTable.id });
        financeReferenceType = "EXPENSE";
        financeReferenceId = expense!.id;
      } else if (sale) {
        financeReferenceType = "PRODUCT_SALE";
        financeReferenceId = created!.id;
      } else if (collaboratorId) {
        const [deduction] = await tx.insert(CommissionDeductionTable).values({
          ...source, companyId, collaboratorId, description: product.name, category: "STOCK_PRODUCT",
          quantity, unitAmountCents: price, amountCents: totalAmountCents, deductedAt: occurredOn, notes,
        }).returning({ id: CommissionDeductionTable.id });
        financeReferenceType = "COMMISSION_DEDUCTION";
        financeReferenceId = deduction!.id;
      }
      await tx.update(item).set({ currentStock, updatedAt: new Date() }).where(itemScope);
      if (financeReferenceType) await tx.update(movement).set({ financeReferenceType, financeReferenceId }).where(and(
        eq(movement.companyId, companyId), eq(movement.id, created!.id),
      ));
      return { ...created!, financeReferenceType, financeReferenceId };
    });
  }

  reverseMovement(companyId: string, id: string) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(companyId, tx);
      const [original] = await tx.select().from(movement).where(and(eq(movement.companyId, companyId),
        eq(movement.id, id), isNull(movement.reversesMovementId)));
      if (!original) throw missing();
      const [existing] = await tx.select().from(movement).where(and(eq(movement.companyId, companyId), eq(movement.reversesMovementId, id)));
      if (existing) return existing;
      const itemScope = and(eq(item.companyId, companyId), eq(item.id, original.itemId));
      const [product] = await tx.select().from(item).where(itemScope);
      if (!product) throw missing();
      const currentStock = checkedStock(product.currentStock, -original.stockDelta);
      if (original.financeReferenceType === "EXPENSE") {
        await tx.delete(ExpenseTable).where(and(eq(ExpenseTable.companyId, companyId),
          eq(ExpenseTable.externalSourceType, inventorySource), eq(ExpenseTable.externalSourceId, original.id)));
      }
      if (original.financeReferenceType === "COMMISSION_DEDUCTION") {
        const [used] = await tx.select({ id: CommissionDeductionApplicationTable.deductionId })
          .from(CommissionDeductionApplicationTable).where(and(eq(CommissionDeductionApplicationTable.companyId, companyId),
            eq(CommissionDeductionApplicationTable.deductionId, original.financeReferenceId!))).limit(1);
        if (used) throw conflict("INVENTORY_WITHDRAWAL_SETTLED");
        await tx.delete(CommissionDeductionTable).where(and(eq(CommissionDeductionTable.companyId, companyId),
          eq(CommissionDeductionTable.externalSourceType, inventorySource), eq(CommissionDeductionTable.externalSourceId, original.id)));
      }
      await tx.update(item).set({ currentStock, updatedAt: new Date() }).where(itemScope);
      const [reversal] = await tx.insert(movement).values({
        companyId, itemId: original.itemId, movementType: original.movementType, quantity: original.quantity,
        unitCostCents: original.unitCostCents, unitSaleCents: original.unitSaleCents, totalAmountCents: original.totalAmountCents,
        collaboratorId: original.collaboratorId, paymentMethod: original.paymentMethod, stockDelta: -original.stockDelta,
        reversesMovementId: original.id, financeReferenceType: original.financeReferenceType,
        financeReferenceId: original.financeReferenceId, occurredAt: paymentInstant(today, timezone),
      }).returning();
      return reversal!;
    });
  }
}
