import { boolean, pgTable, text, timestamp, uuid, index, varchar, jsonb, integer } from "drizzle-orm/pg-core";

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
  
  // Status do cadastro / Ativo para login
  isActive: boolean("is_active").default(true).notNull(),

  // Fuso horÃ¡rio IANA da empresa (fallback de migraÃ§Ã£o: America/Caracas; aceita Brasil/Venezuela/qualquer IANA vÃ¡lida)
  timezone: varchar("timezone", { length: 64 }).default("America/Caracas").notNull(),

  avatarUrl: text("avatar_url"),

  // Dias de funcionamento da empresa (ex: "1,2,3,4,5,6" para Seg a SÃ¡b)
  operatingDays: text("operating_days"),

  // Grade semanal detalhada da empresa (horÃ¡rios de abertura e fechamento por dia)
  operatingSchedule: jsonb("operating_schedule"),
  monthlyGoalInCents: integer("monthly_goal_in_cents").default(0).notNull(),
  monthlyGoalCurrency: varchar("monthly_goal_currency", { length: 3 }).default("BRL").notNull(),
  
  // Auditoria (Garantindo Timezone para o cenÃ¡rio de MaturÃ­n/Venezuela VET UTC-4)
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => {
  return {
    // Ãndice essencial para validar duplicidade de e-mail no login ou novo cadastro
    emailUniqueIdx: index("companies_email_idx").on(table.email),
  };
});
