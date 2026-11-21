import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { InventoryMovementTable } from "./schema/inventory-schema.js";

const movement = InventoryMovementTable;
export const movementDay = (timezone: string) => sql`timezone(${timezone}, ${movement.occurredAt})::date`;
export const saleAmount = sql<number>`case when ${movement.reversesMovementId} is null
  then ${movement.totalAmountCents} else -${movement.totalAmountCents} end`;

export function productCashTotals(companyId: string, timezone: string, from: string, to: string) {
  const day = movementDay(timezone);
  return db.select({
    date: sql<string>`to_char(${day}, 'YYYY-MM-DD')`,
    method: movement.paymentMethod,
    collectedInCents: sql<number>`sum(${saleAmount})`.mapWith(Number),
  }).from(movement).where(and(
    eq(movement.companyId, companyId), eq(movement.movementType, "SALE_OUT"), isNotNull(movement.paymentMethod),
    gte(day, sql`${from}::date`), lte(day, sql`${to}::date`),
  )).groupBy(sql`1`, movement.paymentMethod).then((rows) => rows.flatMap((row) =>
    row.method ? [{ ...row, method: row.method }] : []));
}

