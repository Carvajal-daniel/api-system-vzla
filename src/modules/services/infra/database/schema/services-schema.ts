import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const ServiceTable = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    priceInCents: integer("price_in_cents").notNull(),
    active: boolean("active").notNull().default(true),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("services_duration_minutes_positive_chk", sql`${table.durationMinutes} > 0`),
    check("services_price_in_cents_non_negative_chk", sql`${table.priceInCents} >= 0`),
    uniqueIndex("services_company_normalized_name_uidx").on(
      table.companyId,
      sql`lower(btrim(${table.name}))`,
    ),
    index("services_company_active_idx").on(table.companyId, table.active),
  ],
);
