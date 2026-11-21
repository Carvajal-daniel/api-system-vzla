import { numeric, pgTable, timestamp, uuid, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "./collaborators-schema.js";

/**
 * Tabela de conquistas e troféus do colaborador (ex.: Funcionário do Mês).
 * Registra o histórico mensal de reconhecimentos e pontuações de destaque.
 */
export const CollaboratorAwardTable = pgTable(
  "collaborator_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 150 }).notNull(),
    referenceMonth: varchar("reference_month", { length: 7 }).notNull(), // Formato YYYY-MM
    score: numeric("score", { precision: 5, scale: 2, mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("collaborator_awards_collab_month_idx").on(
      table.companyId,
      table.collaboratorId,
      table.referenceMonth,
    ),
    uniqueIndex("collaborator_awards_company_month_uidx").on(
      table.companyId,
      table.referenceMonth,
    ),
  ],
);
