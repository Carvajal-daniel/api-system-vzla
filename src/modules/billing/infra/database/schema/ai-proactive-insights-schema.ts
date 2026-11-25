import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export type AiProactiveInsightModule =
  | "WHATSAPP"
  | "AGENDA"
  | "FINANCE"
  | "CLIENTS"
  | "SERVICES"
  | "INVENTORY"
  | "TEAM";

export type AiProactiveInsightStatus = "PENDING" | "EXECUTED" | "DISMISSED";

// Armazena recomendações proativas geradas pela IA por módulo de negócio e isoladas por tenant.
export const AiProactiveInsightsTable = pgTable(
  "ai_proactive_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 24 })
      .$type<AiProactiveInsightModule>()
      .notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description").notNull(),
    impactLabel: varchar("impact_label", { length: 80 }),
    actionPayload: jsonb("action_payload").$type<Record<string, unknown> | null>(),
    status: varchar("status", { length: 24 })
      .$type<AiProactiveInsightStatus>()
      .default("PENDING")
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_proactive_insights_tenant_status_created_idx").on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    check(
      "ai_proactive_insights_module_chk",
      sql`${table.module} IN ('WHATSAPP', 'AGENDA', 'FINANCE', 'CLIENTS', 'SERVICES', 'INVENTORY', 'TEAM')`,
    ),
    check(
      "ai_proactive_insights_status_chk",
      sql`${table.status} IN ('PENDING', 'EXECUTED', 'DISMISSED')`,
    ),
  ],
);
