import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { PAYMENT_METHODS } from "../../../../finance/domain/collections.js";
import { inventoryCategories, inventoryUnits, movementTypes } from "../../../domain/inventory.js";

export const InventoryItemTable = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  name: text("name").notNull(),
  sku: text("sku"),
  category: varchar("category", { length: 20, enum: inventoryCategories }).notNull(),
  unit: varchar("unit", { length: 8, enum: inventoryUnits }).notNull(),
  currentStock: integer("current_stock").notNull().default(0),
  minStock: integer("min_stock").notNull().default(0),
  costPriceCents: integer("cost_price_cents").notNull(),
  salePriceCents: integer("sale_price_cents"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("inventory_items_company_id_unique").on(table.companyId, table.id),
  uniqueIndex("inventory_items_company_sku_unique").on(table.companyId, sql`lower(${table.sku})`),
  index("inventory_items_company_active_idx").on(table.companyId, table.isActive, table.name),
  check("inventory_items_stock_check", sql`${table.currentStock} >= 0 and ${table.minStock} >= 0`),
  check("inventory_items_prices_check", sql`${table.costPriceCents} >= 0 and ${table.salePriceCents} >= 0`),
  check("inventory_items_category_check", sql`${table.category} in ('RESALE_PRODUCT','INTERNAL_SUPPLY')`),
  check("inventory_items_unit_check", sql`${table.unit} in ('UN','ML','G','BOX','OTHER')`),
]);

export const InventoryMovementTable = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull(),
  itemId: uuid("item_id").notNull(),
  movementType: varchar("movement_type", { length: 32, enum: movementTypes }).notNull(),
  quantity: integer("quantity").notNull(),
  stockDelta: integer("stock_delta").notNull(),
  unitCostCents: integer("unit_cost_cents").notNull(),
  unitSaleCents: integer("unit_sale_cents"),
  totalAmountCents: integer("total_amount_cents").notNull(),
  collaboratorId: uuid("collaborator_id").references(() => CollaboratorTable.id),
  paymentMethod: varchar("payment_method", { length: 16, enum: PAYMENT_METHODS }),
  notes: text("notes"),
  financeReferenceType: varchar("finance_reference_type", { length: 24, enum: ["EXPENSE", "PRODUCT_SALE", "COMMISSION_DEDUCTION"] }),
  financeReferenceId: uuid("finance_reference_id"),
  requestKey: uuid("request_key"),
  fingerprint: text("fingerprint"),
  reversesMovementId: uuid("reverses_movement_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("inventory_movements_company_id_unique").on(table.companyId, table.id),
  unique("inventory_movements_request_unique").on(table.companyId, table.requestKey),
  unique("inventory_movements_reversal_unique").on(table.companyId, table.reversesMovementId),
  foreignKey({ name: "inventory_movements_item_fk", columns: [table.companyId, table.itemId],
    foreignColumns: [InventoryItemTable.companyId, InventoryItemTable.id] }),
  foreignKey({ name: "inventory_movements_reversal_fk", columns: [table.companyId, table.reversesMovementId],
    foreignColumns: [table.companyId, table.id] }),
  index("inventory_movements_company_date_idx").on(table.companyId, table.occurredAt),
  index("inventory_movements_company_item_idx").on(table.companyId, table.itemId),
  check("inventory_movements_quantity_check", sql`${table.quantity} > 0 and abs(${table.stockDelta}::bigint) = ${table.quantity}`),
  check("inventory_movements_prices_check", sql`${table.unitCostCents} >= 0 and
    (${table.unitSaleCents} is null or ${table.unitSaleCents} >= 0) and ${table.totalAmountCents} >= 0`),
  check("inventory_movements_type_check", sql`${table.movementType} in
    ('PURCHASE_IN','SALE_OUT','COLLABORATOR_WITHDRAWAL','INTERNAL_CONSUMPTION','ADJUSTMENT')`),
  check("inventory_movements_reference_check", sql`(${table.financeReferenceType} is null) = (${table.financeReferenceId} is null)`),
  check("inventory_movements_sale_check", sql`(${table.movementType} = 'SALE_OUT') = (${table.paymentMethod} is not null)
    and (${table.paymentMethod} is null or ${table.paymentMethod} in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER'))`),
]);

export const ImportBatchTable = pgTable("import_batches", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  kind: varchar("kind", { length: 16, enum: ["EXPENSES", "INVENTORY"] }).notNull(),
  requestKey: uuid("request_key").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  imported: integer("imported").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("import_batches_company_kind_request_unique").on(table.companyId, table.kind, table.requestKey)]);
