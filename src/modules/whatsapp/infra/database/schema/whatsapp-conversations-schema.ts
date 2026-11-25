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
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export type WhatsAppConversationStatus =
  | "OPEN"
  | "WAITING_CLIENT"
  | "CONVERTED"
  | "ARCHIVED";

export type WhatsAppAssignedMode = "AI_AUTOPILOT" | "HUMAN";

// Armazena o estado conversacional 1-a-1 por empresa e telefone normalizado (VO Phone).
export const WhatsAppConversationsTable = pgTable(
  "whatsapp_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => ClientTable.id, {
      onDelete: "set null",
    }),
    phone: text("phone").notNull(),
    contactName: text("contact_name"),
    status: varchar("status", { length: 24 })
      .$type<WhatsAppConversationStatus>()
      .default("OPEN")
      .notNull(),
    assignedMode: varchar("assigned_mode", { length: 24 })
      .$type<WhatsAppAssignedMode>()
      .default("AI_AUTOPILOT")
      .notNull(),
    unreadCount: integer("unread_count").default(0).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("whatsapp_conversations_company_phone_unique").on(
      table.companyId,
      table.phone,
    ),
    index("whatsapp_conversations_company_last_message_idx").on(
      table.companyId,
      table.lastMessageAt,
    ),
    check(
      "whatsapp_conversations_status_chk",
      sql`${table.status} IN ('OPEN', 'WAITING_CLIENT', 'CONVERTED', 'ARCHIVED')`,
    ),
    check(
      "whatsapp_conversations_assigned_mode_chk",
      sql`${table.assignedMode} IN ('AI_AUTOPILOT', 'HUMAN')`,
    ),
    check(
      "whatsapp_conversations_unread_non_negative_chk",
      sql`${table.unreadCount} >= 0`,
    ),
  ],
);
