import { jsonb, pgTable, text, timestamp, uuid, varchar, index } from "drizzle-orm/pg-core";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { ServiceTable } from "../../../../services/infra/database/schema/services-schema.js";
import { CollaboratorTable } from "./collaborators-schema.js";

/**
 * Tabela de fila para reagendamento inteligente via Agente de IA / WhatsApp.
 * Quando um profissional é desativado e possui agendamentos futuros,
 * as sessões são enfileiradas aqui com sugestões de outros profissionais ativos habilitados.
 */
export const AiRescheduleQueueTable = pgTable(
  "ai_reschedule_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    formerCollaboratorId: uuid("former_collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => AppointmentTable.id, { onDelete: "cascade" }),
    clientId: text("client_id"),
    clientName: varchar("client_name", { length: 120 }).notNull(),
    clientPhone: varchar("client_phone", { length: 30 }).notNull(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => ServiceTable.id, { onDelete: "cascade" }),
    originalStartsAt: timestamp("original_starts_at", { withTimezone: true }).notNull(),
    suggestedCollaboratorIds: jsonb("suggested_collaborator_ids").$type<string[]>().default([]).notNull(),
    status: varchar("status", { length: 30 }).default("PENDING_AI_AGENT").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("ai_reschedule_queue_company_status_idx").on(table.companyId, table.status),
  ],
);
