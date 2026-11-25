import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export type EvolutionConnectionStatus =
  | "DISCONNECTED"
  | "QRCODE_PENDING"
  | "CONNECTED";

export type DatafyConnectionStatus = "DISCONNECTED" | "CONNECTED";

// Armazena a configuração e o estado dos dois canais de WhatsApp da empresa:
// 1) Evolution API para atendimento conversacional 1-a-1.
// 2) Datafy API Oficial para disparos e campanhas em massa.
export const CompanyWhatsAppConnectionTable = pgTable(
  "company_whatsapp_connections",
  {
    companyId: uuid("company_id")
      .primaryKey()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),

    // Canal Atendimento 1-a-1 (Evolution API)
    evolutionInstanceName: text("evolution_instance_name").unique(),
    evolutionStatus: varchar("evolution_status", { length: 24 })
      .$type<EvolutionConnectionStatus>()
      .default("DISCONNECTED")
      .notNull(),
    evolutionPhoneNumber: text("evolution_phone_number"),

    // Canal Campanhas em Massa (Datafy API Oficial)
    datafyEnabled: boolean("datafy_enabled").default(false).notNull(),
    datafyInstanceId: text("datafy_instance_id"),
    datafyApiTokenEncrypted: text("datafy_api_token_encrypted"),
    datafyStatus: varchar("datafy_status", { length: 24 })
      .$type<DatafyConnectionStatus>()
      .default("DISCONNECTED")
      .notNull(),

    // Configurações gerais do canal de atendimento
    aiAutopilotEnabled: boolean("ai_autopilot_enabled").default(true).notNull(),
    aiSystemPrompt: text("ai_system_prompt"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "company_whatsapp_evolution_status_chk",
      sql`${table.evolutionStatus} IN ('DISCONNECTED', 'QRCODE_PENDING', 'CONNECTED')`,
    ),
    check(
      "company_whatsapp_datafy_status_chk",
      sql`${table.datafyStatus} IN ('DISCONNECTED', 'CONNECTED')`,
    ),
  ],
);
