import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export type AiUsageFeature =
  | "BOOKING"
  | "COPILOT"
  | "RETENTION"
  | "INSIGHTS"
  | "MODULE_ANALYSIS";

// Trilha de auditoria granular de chamadas de IA por tenant, recurso e modelo para governança de custos.
export const AiUsageLogsTable = pgTable(
  "ai_usage_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    feature: varchar("feature", { length: 32 })
      .$type<AiUsageFeature>()
      .notNull(),
    model: varchar("model", { length: 120 }).notNull(),
    promptTokens: integer("prompt_tokens").default(0).notNull(),
    completionTokens: integer("completion_tokens").default(0).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_usage_logs_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    check(
      "ai_usage_logs_feature_chk",
      sql`${table.feature} IN ('BOOKING', 'COPILOT', 'RETENTION', 'INSIGHTS', 'MODULE_ANALYSIS')`,
    ),
    check(
      "ai_usage_logs_tokens_non_negative_chk",
      sql`${table.promptTokens} >= 0 AND ${table.completionTokens} >= 0`,
    ),
  ],
);
