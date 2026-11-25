import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { WhatsAppConversationsTable } from "./whatsapp-conversations-schema.js";

export type WhatsAppMessageDirection = "INBOUND" | "OUTBOUND";
export type WhatsAppMessageSenderType = "CLIENT" | "AI_AGENT" | "OWNER";

// Histórico de mensagens trocadas na Inbox de WhatsApp com idempotência por external_message_id.
export const WhatsAppMessagesTable = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => WhatsAppConversationsTable.id, { onDelete: "cascade" }),
    externalMessageId: text("external_message_id"),
    direction: varchar("direction", { length: 16 })
      .$type<WhatsAppMessageDirection>()
      .notNull(),
    senderType: varchar("sender_type", { length: 16 })
      .$type<WhatsAppMessageSenderType>()
      .notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_messages_company_external_id_unique")
      .on(table.companyId, table.externalMessageId)
      .where(sql`${table.externalMessageId} IS NOT NULL`),
    index("whatsapp_messages_company_conversation_sent_idx").on(
      table.companyId,
      table.conversationId,
      table.sentAt,
    ),
    check(
      "whatsapp_messages_direction_chk",
      sql`${table.direction} IN ('INBOUND', 'OUTBOUND')`,
    ),
    check(
      "whatsapp_messages_sender_type_chk",
      sql`${table.senderType} IN ('CLIENT', 'AI_AGENT', 'OWNER')`,
    ),
  ],
);
