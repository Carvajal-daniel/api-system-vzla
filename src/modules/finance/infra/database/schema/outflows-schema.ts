import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { PAYMENT_METHODS } from "../../../domain/collections.js";
import { COMMISSION_DEDUCTION_CATEGORIES, EXPENSE_CATEGORIES, EXPENSE_STATUSES, EXPENSE_TYPES } from "../../../domain/outflows.js";

export const ExpenseTable = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  description: text("description").notNull(),
  category: varchar("category", { length: 20, enum: EXPENSE_CATEGORIES }).notNull(),
  expenseType: varchar("expense_type", { length: 8, enum: EXPENSE_TYPES }).notNull(),
  amountCents: integer("amount_cents").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmountCents: integer("unit_amount_cents"),
  dueDate: date("due_date").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentMethod: varchar("payment_method", { length: 16, enum: PAYMENT_METHODS }),
  status: varchar("status", { length: 8, enum: EXPENSE_STATUSES }).default("PENDING").notNull(),
  isRecurring: boolean("is_recurring").notNull().default(false),
  notes: text("notes"),
  externalSourceType: varchar("external_source_type", { length: 40 }),
  externalSourceId: varchar("external_source_id", { length: 128 }),
  requestKey: uuid("request_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("expenses_company_due_idx").on(t.companyId, t.dueDate),
  index("expenses_company_paid_idx").on(t.companyId, t.paidAt),
  unique("expenses_company_source_unique").on(t.companyId, t.externalSourceType, t.externalSourceId),
  unique("expenses_company_request_unique").on(t.companyId, t.requestKey),
  check("expenses_category_check", sql`${t.category} in ('RENT','UTILITIES','MARKETING','MAINTENANCE','STOCK_PURCHASE','OTHER')`),
  check("expenses_type_check", sql`${t.expenseType} in ('FIXED','VARIABLE')`),
  check("expenses_quantity_check", sql`${t.quantity} >= 1`),
  check("expenses_unit_amount_check", sql`(
    (${t.unitAmountCents} is null and ${t.quantity} = 1) or
    (${t.unitAmountCents} is not null and ${t.unitAmountCents} > 0 and ${t.amountCents} = ${t.quantity}::bigint * ${t.unitAmountCents})
  )`),
  check("expenses_positive_check", sql`${t.amountCents} > 0`),
  check("expenses_source_check", sql`(${t.externalSourceType} is null) = (${t.externalSourceId} is null)`),
  check("expenses_payment_check", sql`(${t.status} = 'PAID' and ${t.paidAt} is not null and ${t.paymentMethod} is not null)
    or (${t.status} in ('PENDING','OVERDUE') and ${t.paidAt} is null and ${t.paymentMethod} is null)`),
  check("expenses_method_check", sql`${t.paymentMethod} in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER')`),
]);

export const CommissionSettlementTable = pgTable("commission_settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  collaboratorId: uuid("collaborator_id").notNull().references(() => CollaboratorTable.id),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentMethod: varchar("payment_method", { length: 16, enum: PAYMENT_METHODS }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  requestKey: uuid("request_key"),
  recordedBy: uuid("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("commission_settlements_company_id_unique").on(t.companyId, t.id),
  unique("commission_settlements_company_request_unique").on(t.companyId, t.requestKey),
  index("commission_settlements_company_paid_idx").on(t.companyId, t.paidAt),
  check("commission_settlements_amount_check", sql`${t.amountCents} >= 0`),
  check("commission_settlements_period_check", sql`${t.periodStart} <= ${t.periodEnd}`),
  check("commission_settlements_method_check", sql`${t.paymentMethod} in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER')`),
]);

export const CommissionDeductionTable = pgTable("commission_deductions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  collaboratorId: uuid("collaborator_id").notNull().references(() => CollaboratorTable.id),
  description: text("description").notNull(),
  category: varchar("category", { length: 20, enum: COMMISSION_DEDUCTION_CATEGORIES }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitAmountCents: integer("unit_amount_cents"),
  amountCents: integer("amount_cents").notNull(),
  deductedAt: date("deducted_at").notNull(),
  notes: text("notes"),
  settlementId: uuid("settlement_id"),
  externalSourceType: varchar("external_source_type", { length: 40 }),
  externalSourceId: varchar("external_source_id", { length: 128 }),
  requestKey: uuid("request_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("commission_deductions_company_id_unique").on(t.companyId, t.id),
  unique("commission_deductions_company_source_unique").on(t.companyId, t.externalSourceType, t.externalSourceId),
  unique("commission_deductions_company_request_unique").on(t.companyId, t.requestKey),
  index("commission_deductions_company_person_date_idx").on(t.companyId, t.collaboratorId, t.deductedAt),
  foreignKey({ name: "commission_deductions_settlement_fk", columns: [t.companyId, t.settlementId],
    foreignColumns: [CommissionSettlementTable.companyId, CommissionSettlementTable.id] }),
  check("commission_deductions_category_check", sql`${t.category} in ('STOCK_PRODUCT','ADVANCE','OTHER')`),
  check("commission_deductions_amount_check", sql`${t.amountCents} > 0 and ${t.quantity} > 0 and
    (${t.unitAmountCents} is null or (${t.unitAmountCents} > 0 and ${t.amountCents} = ${t.quantity}::bigint * ${t.unitAmountCents}))`),
  check("commission_deductions_source_check", sql`(${t.externalSourceType} is null) = (${t.externalSourceId} is null)`),
]);

export const CommissionDeductionApplicationTable = pgTable("commission_deduction_applications", {
  companyId: uuid("company_id").notNull(),
  deductionId: uuid("deduction_id").notNull(),
  settlementId: uuid("settlement_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
}, (t) => [
  unique("commission_deduction_applications_unique").on(t.companyId, t.deductionId, t.settlementId),
  index("commission_deduction_applications_settlement_idx").on(t.companyId, t.settlementId),
  foreignKey({ name: "commission_deduction_applications_deduction_fk", columns: [t.companyId, t.deductionId],
    foreignColumns: [CommissionDeductionTable.companyId, CommissionDeductionTable.id] }),
  foreignKey({ name: "commission_deduction_applications_settlement_fk", columns: [t.companyId, t.settlementId],
    foreignColumns: [CommissionSettlementTable.companyId, CommissionSettlementTable.id] }),
  check("commission_deduction_applications_amount_check", sql`${t.amountCents} > 0`),
]);
