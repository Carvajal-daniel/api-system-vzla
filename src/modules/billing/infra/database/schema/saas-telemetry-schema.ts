import { bigint, date, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const SaasTelemetryTable = pgTable("saas_telemetry_events", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  aiTurnsL0: bigint("ai_turns_l0", { mode: "number" }).default(0).notNull(),
  aiTurnsL1: bigint("ai_turns_l1", { mode: "number" }).default(0).notNull(),
  aiTurnsL2: bigint("ai_turns_l2", { mode: "number" }).default(0).notNull(),
  tokensInput: bigint("tokens_input", { mode: "number" }).default(0).notNull(),
  tokensOutput: bigint("tokens_output", { mode: "number" }).default(0).notNull(),
  appointmentsCreatedByAi: bigint("appointments_created_by_ai", { mode: "number" }).default(0).notNull(),
  appointmentsCreatedManual: bigint("appointments_created_manual", { mode: "number" }).default(0).notNull(),
  activeClubSubscribers: bigint("active_club_subscribers", { mode: "number" }),
  gmvCents: bigint("gmv_cents", { mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.companyId, table.date] })]);
