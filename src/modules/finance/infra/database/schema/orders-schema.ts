import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { PAYMENT_METHODS } from "../../../domain/collections.js";
import {
  ORDER_COMMISSION_STATUSES,
  ORDER_ITEM_TYPES,
  ORDER_STATUSES,
} from "../../../domain/orders.js";
import { CommissionSettlementTable } from "./outflows-schema.js";

export const FinanceOrderTable = pgTable(
  "finance_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id),
    code: varchar("code", { length: 40 }).notNull(),
    appointmentId: uuid("appointment_id").references(() => AppointmentTable.id),
    clientName: text("client_name"),
    clientPhone: text("client_phone"),
    clientDocument: text("client_document"),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16, enum: ORDER_STATUSES }).notNull().default("OPEN"),
    subtotalCents: integer("subtotal_cents").notNull(),
    discountCents: integer("discount_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    paidCents: integer("paid_cents").notNull().default(0),
    notes: text("notes"),
    requestKey: uuid("request_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("finance_orders_company_id_unique").on(table.companyId, table.id),
    unique("finance_orders_company_request_unique").on(table.companyId, table.requestKey),
    index("finance_orders_company_date_idx").on(table.companyId, table.orderDate),
    check("finance_orders_status_check", sql`${table.status} in ('OPEN','CLOSED')`),
    check(
      "finance_orders_amounts_check",
      sql`${table.subtotalCents} >= 0 and ${table.discountCents} >= 0 and ${table.totalCents} >= 0 and ${table.paidCents} >= 0`,
    ),
  ],
);

export const FinanceOrderItemTable = pgTable(
  "finance_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id),
    orderId: uuid("order_id").notNull(),
    itemType: varchar("item_type", { length: 16, enum: ORDER_ITEM_TYPES }).notNull(),
    referenceId: uuid("reference_id"),
    name: text("name").notNull(),
    collaboratorId: uuid("collaborator_id").references(() => CollaboratorTable.id),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
    commissionPercentage: integer("commission_percentage").notNull().default(0),
    commissionCents: integer("commission_cents").notNull().default(0),
    commissionStatus: varchar("commission_status", {
      length: 16,
      enum: ORDER_COMMISSION_STATUSES,
    })
      .notNull()
      .default("NONE"),
    commissionSettlementId: uuid("commission_settlement_id").references(
      () => CommissionSettlementTable.id,
    ),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "finance_order_items_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [FinanceOrderTable.companyId, FinanceOrderTable.id],
    }).onDelete("cascade"),
    index("finance_order_items_company_order_idx").on(table.companyId, table.orderId),
    index("finance_order_items_company_collab_idx").on(
      table.companyId,
      table.collaboratorId,
      table.commissionStatus,
    ),
    check("finance_order_items_type_check", sql`${table.itemType} in ('SERVICE','PRODUCT','TIP')`),
    check(
      "finance_order_items_qty_check",
      sql`${table.quantity} > 0 and ${table.unitPriceCents} >= 0 and ${table.subtotalCents} >= 0`,
    ),
    check(
      "finance_order_items_commission_check",
      sql`${table.commissionPercentage} between 0 and 100 and ${table.commissionCents} >= 0`,
    ),
    check(
      "finance_order_items_commission_status_check",
      sql`${table.commissionStatus} in ('NONE','PENDING','PAID')`,
    ),
  ],
);

export const FinanceOrderPaymentTable = pgTable(
  "finance_order_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id),
    orderId: uuid("order_id").notNull(),
    method: varchar("method", { length: 16, enum: PAYMENT_METHODS }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "finance_order_payments_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [FinanceOrderTable.companyId, FinanceOrderTable.id],
    }).onDelete("cascade"),
    index("finance_order_payments_company_order_idx").on(table.companyId, table.orderId),
    check(
      "finance_order_payments_method_check",
      sql`${table.method} in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER')`,
    ),
    check("finance_order_payments_amount_check", sql`${table.amountCents} > 0`),
  ],
);

export const FinanceOrderAuditLogTable = pgTable(
  "finance_order_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    previousStatus: varchar("previous_status", { length: 16 }).notNull(),
    newStatus: varchar("new_status", { length: 16 }).notNull(),
    reason: text("reason").notNull(),
    authorizedById: uuid("authorized_by_id").notNull(),
    authorizedByRole: varchar("authorized_by_role", { length: 20 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "finance_order_audit_logs_order_fk",
      columns: [table.companyId, table.orderId],
      foreignColumns: [FinanceOrderTable.companyId, FinanceOrderTable.id],
    }).onDelete("cascade"),
    index("finance_order_audit_logs_company_order_idx").on(
      table.companyId,
      table.orderId,
      table.createdAt,
    ),
  ],
);
