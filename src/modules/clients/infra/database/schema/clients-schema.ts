import {
  bigint,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

// Base normalizada de clientes isolada por empresa (multi-tenant).
// O telefone é sempre armazenado normalizado via Value Object Phone, com unicidade por empresa.
export const ClientTable = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    birthDate: date("birth_date"),
    tags: jsonb("tags").$type<string[]>().default([]).notNull(),
    notes: text("notes"),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    totalSpentCents: bigint("total_spent_cents", { mode: "number" })
      .default(0)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("clients_company_phone_unique").on(table.companyId, table.phone),
    index("clients_company_name_idx").on(table.companyId, table.name),
  ],
);
