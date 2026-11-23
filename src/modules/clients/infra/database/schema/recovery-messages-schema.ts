import { sql } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const RecoveryMessageTable = pgTable("client_recovery_messages", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  approvalId: uuid("approval_id").notNull(),
  clientId: text("client_id").notNull(),
  approvedMessage: text("approved_message").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  messageId: text("message_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.approvalId] }),
  uniqueIndex("client_recovery_pending_idx").on(table.companyId, table.clientId).where(sql`${table.messageId} IS NULL`),
]);
