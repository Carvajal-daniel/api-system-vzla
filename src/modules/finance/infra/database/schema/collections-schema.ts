import {
  check, date, foreignKey, index, integer, pgTable, smallint, text,
  timestamp, unique, uuid, varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { PAYMENT_METHODS, type Currency } from "../../../domain/collections.js";

import { CommissionSettlementTable } from "./outflows-schema.js";

export const FinancialDocumentTable = pgTable("financial_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id),
  appointmentId: uuid("appointment_id").notNull(),
  currency: varchar("currency", { length: 3 }).$type<Currency>().notNull(),
  netInCents: integer("net_in_cents").notNull(),
  generatedCommissionInCents: integer("generated_commission_in_cents"),
  commissionPaidAt: timestamp("commission_paid_at", { withTimezone: true }),
  commissionPaidBy: uuid("commission_paid_by"),
  commissionSettlementId: uuid("commission_settlement_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("financial_documents_company_appointment_unique").on(table.companyId, table.appointmentId),
  unique("financial_documents_company_id_unique").on(table.companyId, table.id),
  foreignKey({
    columns: [table.companyId, table.appointmentId],
    foreignColumns: [AppointmentTable.companyId, AppointmentTable.id],
    name: "financial_documents_company_appointment_fk",
  }),
  foreignKey({
    columns: [table.companyId, table.commissionSettlementId],
    foreignColumns: [CommissionSettlementTable.companyId, CommissionSettlementTable.id],
    name: "financial_documents_commission_settlement_fk",
  }),
  check("financial_documents_amounts_check", sql`${table.netInCents} >= 0 and ${table.generatedCommissionInCents} between 0 and ${table.netInCents}`),
  check("financial_documents_currency_check", sql`${table.currency} in ('BRL', 'USD')`),
  check("financial_documents_batch_paid_check", sql`${table.commissionSettlementId} is null or ${table.commissionPaidAt} is not null`),
  check("financial_documents_settled_check", sql`(${table.commissionPaidAt} is null) = (${table.commissionPaidBy} is null)`),
]);

export const ReceiptTable = pgTable("receipts", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull(),
  documentId: uuid("document_id").notNull(),
  amountInCents: integer("amount_in_cents").notNull(),
  method: varchar("method", { length: 16, enum: PAYMENT_METHODS }).notNull(),
  effectiveOn: date("effective_on").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  recordedBy: uuid("recorded_by").notNull(),
  requestKey: uuid("request_key").notNull(),
  position: smallint("position").notNull(),
  reversesReceiptId: uuid("reverses_receipt_id"),
  reason: text("reason"),
}, (table) => [
  unique("receipts_company_request_position_unique").on(table.companyId, table.requestKey, table.position),
  unique("receipts_company_document_id_unique").on(table.companyId, table.documentId, table.id),
  foreignKey({
    columns: [table.companyId, table.documentId],
    foreignColumns: [FinancialDocumentTable.companyId, FinancialDocumentTable.id],
    name: "receipts_company_document_fk",
  }),
  foreignKey({
    columns: [table.companyId, table.documentId, table.reversesReceiptId],
    foreignColumns: [table.companyId, table.documentId, table.id],
    name: "receipts_company_document_original_fk",
  }),
  index("receipts_company_effective_idx").on(table.companyId, table.effectiveOn),
  index("receipts_company_document_idx").on(table.companyId, table.documentId),
  check("receipts_amount_check", sql`${table.amountInCents} > 0 and ${table.position} between 0 and 1`),
  check("receipts_method_check", sql`${table.method} in ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER')`),
  check("receipts_reversal_reason_check", sql`(
    (${table.reversesReceiptId} is null and ${table.reason} is null) or
    (${table.reversesReceiptId} is not null and ${table.reason} is not null and length(trim(${table.reason})) between 1 and 500)
  )`),
]);
