import { boolean, pgTable, text, timestamp, uuid, index, varchar, jsonb, integer, check, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { Currency } from "../../../../finance/domain/collections.js";
import {
  DEFAULT_COMPANY_RANKING_WEIGHTS,
  type CompanyRankingWeights,
} from "../../../domain/ranking-weights.js";

export const CompanyTable = pgTable("companies", { 

  id: uuid("id").primaryKey().defaultRandom(),
  

  companyName: text("company_name").notNull(),
  
  // Nome do contato*
  name: text("name").notNull(),
  
  phone: text("phone").notNull(),
  
  // E-mail Para Acesso*
  email: text("email").notNull().unique(),
  
  // Senha (MÃ­nimo de 6 e mÃ¡ximo de 15 caracteres)* -> Salvaremos o Hash
  password: text("password").notNull(),

  // Hash bcrypt do PIN numérico (4-6 dígitos) do dono para autorizar reabertura de comandas fechadas
  ownerPinHash: text("owner_pin_hash"),
  
  // Status do cadastro / Ativo para login
  isActive: boolean("is_active").default(true).notNull(),

  // Fuso horÃ¡rio IANA da empresa (fallback de migraÃ§Ã£o: America/Caracas; aceita Brasil/Venezuela/qualquer IANA vÃ¡lida)
  timezone: varchar("timezone", { length: 64 }).default("America/Caracas").notNull(),

  avatarUrl: text("avatar_url"),

  // Dias de funcionamento da empresa (ex: "1,2,3,4,5,6" para Seg a SÃ¡b)
  operatingDays: text("operating_days"),

  // Grade semanal detalhada da empresa (horÃ¡rios de abertura e fechamento por dia)
  operatingSchedule: jsonb("operating_schedule"),
  // Pesos configuráveis do dono para o cálculo do ranking e Funcionário do Mês (soma = 100)
  rankingWeights: jsonb("ranking_weights")
    .$type<CompanyRankingWeights>()
    .default(DEFAULT_COMPANY_RANKING_WEIGHTS)
    .notNull(),
  saasPlan: text("saas_plan", { enum: ["ESSENTIAL", "PRO", "SCALE"] }).default("PRO").notNull(),
  hasOfficialApiAddon: boolean("has_official_api_addon").default(false).notNull(),
  saasStatus: text("saas_status", { enum: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"] }).default("TRIAL").notNull(),
  monthlyAiQuota: integer("monthly_ai_quota").default(400).notNull(),
  monthlyGoalInCents: integer("monthly_goal_in_cents").default(0).notNull(),
  currency: varchar("currency", { length: 3 }).$type<Currency>().default("BRL").notNull(),
  financeOpenedOn: date("finance_opened_on").default(sql`CURRENT_DATE`).notNull(),
  monthlyGoalCurrency: varchar("monthly_goal_currency", { length: 3 }).default("BRL").notNull(),
  
  // Auditoria (Garantindo Timezone para o cenÃ¡rio de MaturÃ­n/Venezuela VET UTC-4)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    saasPlanCheck: check("companies_saas_plan_check", sql`${table.saasPlan} in ('ESSENTIAL', 'PRO', 'SCALE')`),
    saasStatusCheck: check("companies_saas_status_check", sql`${table.saasStatus} in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED')`),
    monthlyAiQuotaCheck: check("companies_monthly_ai_quota_check", sql`${table.monthlyAiQuota} >= 0`),
    currencyCheck: check("companies_currency_check", sql`${table.currency} in ('BRL', 'USD', 'VES')`),
    // Ãndice essencial para validar duplicidade de e-mail no login ou novo cadastro
    emailUniqueIdx: index("companies_email_idx").on(table.email),
  };
});
