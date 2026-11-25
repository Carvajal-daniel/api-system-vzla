import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { WhatsAppConversationsTable } from "./whatsapp-conversations-schema.js";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export type DetectedObjection =
  | "NONE"
  | "TIMING"
  | "SCHEDULE_FULL"
  | "PRICE"
  | "PAYMENT_METHOD"
  | "OTHER";

// Persiste a análise comercial gerada pela IA para cada conversa de WhatsApp (1-para-1 por empresa).
export const AiConversationInsightsTable = pgTable(
  "ai_conversation_insights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => WhatsAppConversationsTable.id, { onDelete: "cascade" }),
    leadTemperature: varchar("lead_temperature", { length: 16 })
      .$type<LeadTemperature>()
      .default("WARM")
      .notNull(),
    leadScore: integer("lead_score").default(50).notNull(),
    summary: text("summary").notNull(),
    detectedObjection: varchar("detected_objection", { length: 24 })
      .$type<DetectedObjection>()
      .default("NONE")
      .notNull(),
    recommendedNextAction: text("recommended_next_action").notNull(),
    suggestedFollowupReply: text("suggested_followup_reply").notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ai_conversation_insights_company_conversation_unique").on(
      table.companyId,
      table.conversationId,
    ),
    uniqueIndex("ai_conversation_insights_conversation_unique").on(
      table.conversationId,
    ),
    index("ai_conversation_insights_company_temp_updated_idx").on(
      table.companyId,
      table.leadTemperature,
      table.updatedAt,
    ),
    check(
      "ai_conversation_insights_temperature_chk",
      sql`${table.leadTemperature} IN ('HOT', 'WARM', 'COLD')`,
    ),
    check(
      "ai_conversation_insights_score_chk",
      sql`${table.leadScore} >= 0 AND ${table.leadScore} <= 100`,
    ),
    check(
      "ai_conversation_insights_objection_chk",
      sql`${table.detectedObjection} IN ('NONE', 'TIMING', 'SCHEDULE_FULL', 'PRICE', 'PAYMENT_METHOD', 'OTHER')`,
    ),
  ],
);
