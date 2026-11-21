import { integer, pgTable, text, timestamp, uuid, varchar, index } from "drizzle-orm/pg-core";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "./collaborators-schema.js";

/**
 * Tabela de avaliações e comentários recebidos pelos colaboradores.
 * Utilizada para compor 35% do índice de desempenho no motor de ranking.
 */
export const CollaboratorReviewTable = pgTable(
  "collaborator_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => AppointmentTable.id, {
      onDelete: "set null",
    }),
    clientId: text("client_id"),
    clientName: varchar("client_name", { length: 120 }).notNull(),
    serviceName: varchar("service_name", { length: 120 }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("collaborator_reviews_collab_idx").on(table.companyId, table.collaboratorId),
  ],
);
