import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

// Consolida o consumo mensal por tenant (sessões IA, disparos WhatsApp e tokens),
// permitindo bloqueio de cotas rápido e atualizações atômicas via ON CONFLICT (tenant_id, period_month).
export const TenantUsageMetricsTable = pgTable(
  "tenant_usage_metrics",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    periodMonth: varchar("period_month", { length: 7 }).notNull(),
    aiSessionsCount: integer("ai_sessions_count").default(0).notNull(),
    outboundMessagesCount: integer("outbound_messages_count")
      .default(0)
      .notNull(),
    totalInputTokens: integer("total_input_tokens").default(0).notNull(),
    totalOutputTokens: integer("total_output_tokens").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenant_usage_metrics_tenant_period_unique").on(
      table.tenantId,
      table.periodMonth,
    ),
    check(
      "tenant_usage_metrics_period_format_chk",
      sql`${table.periodMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check(
      "tenant_usage_metrics_counters_non_negative_chk",
      sql`${table.aiSessionsCount} >= 0 AND ${table.outboundMessagesCount} >= 0 AND ${table.totalInputTokens} >= 0 AND ${table.totalOutputTokens} >= 0`,
    ),
  ],
);
