import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

/**
 * Tabela de colaboradores (profissionais) da empresa parceira.
 * Armazena dados cadastrais, perfil, jornada, metas e estado de ativação para preservar histórico financeiro e de agenda.
 */
export const CollaboratorTable = pgTable(
  "collaborators",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    password: text("password").notNull(),
    phone: text("phone").notNull(),
    whatsapp: varchar("whatsapp", { length: 30 }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    specialty: text("specialty").notNull(),
    bio: text("bio"),
    // Percentual padrão de comissão (mantido para compatibilidade histórica com finanças e agendamentos)
    commissionPercentage: numeric("commission_percentage", { mode: "number" }).notNull().default(0),
    defaultCommissionRate: numeric("default_commission_rate", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull().default(0),
    // Meta de receita mensal estipulada em centavos ou valor monetário padrão
    monthlyRevenueGoal: integer("monthly_revenue_goal"),
    // Flag booleana mantida para compatibilidade direta com consultas legadas
    isActive: boolean("is_active").notNull().default(true),
    // Status do profissional (ACTIVE | INACTIVE) - profissionais desligados nunca sofrem DELETE físico
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    avatarUrl: text("avatar_url"),
    // Data de admissão para cálculo de antiguidade e ranking
    hiredAt: timestamp("hired_at", { withTimezone: true }).defaultNow().notNull(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivationReason: text("deactivation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("collaborators_company_id_idx").on(table.companyId),
    index("collaborators_status_idx").on(table.companyId, table.status),
  ],
);
