import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const SubscriptionPlanTable = pgTable("subscription_plans", {
  id: uuid("id").defaultRandom().notNull(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull().default(0),
  billingCycle: text("billing_cycle", { enum: ["MONTHLY"] }).notNull().default("MONTHLY"),
  includedServiceIds: uuid("included_service_ids").array().notNull().default(sql`'{}'`),
  maxMonthlyUses: integer("max_monthly_uses"),
  active: boolean("active").notNull().default(true),
  allowedDaysOfWeek: integer("allowed_days_of_week").array(),
  gracePeriodDays: integer("grace_period_days").default(3).notNull(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.id] }),
  check("subscription_plans_price_cents_check", sql`${table.priceCents} >= 0`),
  check("subscription_plans_billing_cycle_check", sql`${table.billingCycle} = 'MONTHLY'`),
  check("subscription_plans_max_monthly_uses_check", sql`${table.maxMonthlyUses} >= 0`),
  check("subscription_plans_allowed_days_check", sql`array_position(${table.allowedDaysOfWeek}, NULL) IS NULL AND ${table.allowedDaysOfWeek} <@ ARRAY[0,1,2,3,4,5,6]`),
  check("subscription_plans_grace_period_check", sql`${table.gracePeriodDays} >= 0`),
]);

export const ClubSubscriptionTable = pgTable("club_subscriptions", {
  companyId: uuid("company_id").notNull(),
  clientPhone: text("client_phone").notNull(),
  planId: uuid("plan_id").notNull(),
  status: text("status", { enum: ["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.clientPhone] }),
  foreignKey({ columns: [table.companyId, table.planId], foreignColumns: [SubscriptionPlanTable.companyId, SubscriptionPlanTable.id] }).onDelete("cascade"),
  check("club_subscriptions_status_check", sql`${table.status} in ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED')`),
]);
