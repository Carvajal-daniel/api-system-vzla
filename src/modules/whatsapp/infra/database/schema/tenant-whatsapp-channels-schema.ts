import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export type TenantWhatsAppChannelProvider = "EVOLUTION" | "META_OFFICIAL";

export type TenantWhatsAppChannelPurpose =
  | "ALL"
  | "RECEPTION_ONLY"
  | "CAMPAIGNS_ONLY";

export type TenantWhatsAppChannelStatus =
  | "CONNECTED"
  | "DISCONNECTED"
  | "QRCODE_PENDING";

export interface EvolutionChannelCredentials {
  instanceName?: string;
  apiKey?: string;
}

export interface MetaOfficialChannelCredentials {
  phoneNumberId?: string;
  wabaId?: string;
  accessToken?: string;
}

export type TenantWhatsAppChannelCredentials = EvolutionChannelCredentials &
  MetaOfficialChannelCredentials &
  Record<string, unknown>;

// Armazena múltiplos canais híbridos de WhatsApp por tenant (Evolution e Meta Oficial),
// permitindo roteamento por finalidade (atendimento vs campanhas) com isolamento estrito por tenant_id.
export const TenantWhatsAppChannelsTable = pgTable(
  "tenant_whatsapp_channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 24 })
      .$type<TenantWhatsAppChannelProvider>()
      .notNull(),
    purpose: varchar("purpose", { length: 24 })
      .$type<TenantWhatsAppChannelPurpose>()
      .default("ALL")
      .notNull(),
    phoneNumber: varchar("phone_number", { length: 32 }),
    status: varchar("status", { length: 24 })
      .$type<TenantWhatsAppChannelStatus>()
      .default("DISCONNECTED")
      .notNull(),
    credentials: jsonb("credentials")
      .$type<TenantWhatsAppChannelCredentials>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tenant_whatsapp_channels_tenant_status_idx").on(
      table.tenantId,
      table.status,
    ),
    // Garante unicidade do número por provedor apenas quando o telefone já foi associado ao canal.
    uniqueIndex("tenant_whatsapp_channels_provider_phone_unique")
      .on(table.provider, table.phoneNumber)
      .where(sql`${table.phoneNumber} IS NOT NULL`),
    check(
      "tenant_whatsapp_channels_provider_chk",
      sql`${table.provider} IN ('EVOLUTION', 'META_OFFICIAL')`,
    ),
    check(
      "tenant_whatsapp_channels_purpose_chk",
      sql`${table.purpose} IN ('ALL', 'RECEPTION_ONLY', 'CAMPAIGNS_ONLY')`,
    ),
    check(
      "tenant_whatsapp_channels_status_chk",
      sql`${table.status} IN ('CONNECTED', 'DISCONNECTED', 'QRCODE_PENDING')`,
    ),
  ],
);
