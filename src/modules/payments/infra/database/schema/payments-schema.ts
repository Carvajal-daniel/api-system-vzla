
import { sql } from "drizzle-orm";
import { check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { SubscriptionPlanTable } from "../../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { FinanceOrderTable } from "../../../../finance/infra/database/schema/orders-schema.js";
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { chargeMethods, chargeReferences, chargeStatuses, onlinePaymentProviders, paymentProviders, subscriptionMethods, subscriptionStatuses } from "../../../domain/payment-gateway.js";

export const CompanyPaymentConfigTable = pgTable("company_payment_configs", {
  companyId: uuid("company_id").primaryKey().references(() => CompanyTable.id, { onDelete: "cascade" }),
  paymentProvider: text("payment_provider", { enum: paymentProviders }).notNull().default("NONE"),
  providerApiKeyEncrypted: text("provider_api_key_encrypted"),
  webhookTokenEncrypted: text("webhook_token_encrypted"),
  staticPixKey: text("static_pix_key"),
}, (t) => [check("company_payment_provider_check", sql`${t.paymentProvider} in ('NONE','ASAAS','MERCADO_PAGO','SANDBOX')`)]);

export const ClientSubscriptionTable = pgTable("client_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull(),
  planId: uuid("plan_id").notNull(),
  status: text("status", { enum: subscriptionStatuses }).notNull().default("PENDING_PAYMENT"),
  paymentMethod: text("payment_method", { enum: subscriptionMethods }).notNull(),
  paymentProvider: text("payment_provider", { enum: onlinePaymentProviders }).notNull(),
  priceCents: integer("price_cents").notNull(),
  externalSubscriptionId: text("external_subscription_id"),
  checkoutUrl: text("checkout_url"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  nextBillingDate: date("next_billing_date", { mode: "string" }).notNull(),
}, (t) => [
  foreignKey({ name: "client_subscriptions_client_fk", columns: [t.companyId, t.clientId], foreignColumns: [ClientTable.companyId, ClientTable.id] }).onDelete("cascade"),
  foreignKey({ name: "client_subscriptions_plan_fk", columns: [t.companyId, t.planId], foreignColumns: [SubscriptionPlanTable.companyId, SubscriptionPlanTable.id] }).onDelete("restrict"),
  uniqueIndex("client_subscriptions_current_idx").on(t.companyId, t.clientId).where(sql`${t.status} <> 'CANCELED'`),
  uniqueIndex("client_subscriptions_external_idx").on(t.companyId, t.paymentProvider, t.externalSubscriptionId),
  index("client_subscriptions_status_idx").on(t.companyId, t.status),
  check("client_subscriptions_status_check", sql`${t.status} in ('PENDING_PAYMENT','ACTIVE','PAST_DUE','SUSPENDED','CANCELED')`),
  check("client_subscriptions_payment_method_check", sql`${t.paymentMethod} in ('PIX','CREDIT_CARD')`),
  check("client_subscriptions_payment_provider_check", sql`${t.paymentProvider} in ('ASAAS','MERCADO_PAGO','SANDBOX')`),
  check("client_subscriptions_price_cents_check", sql`${t.priceCents} > 0`),
  check("client_subscriptions_period_check", sql`(${t.currentPeriodStart} is null and ${t.currentPeriodEnd} is null) or (${t.currentPeriodStart} is not null and ${t.currentPeriodEnd} > ${t.currentPeriodStart})`),
]);

export const PaymentChargeTable = pgTable("payment_charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  referenceType: text("reference_type", { enum: chargeReferences }).notNull(),
  referenceId: uuid("reference_id").notNull(),
  clientId: uuid("client_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  method: text("method", { enum: chargeMethods }).notNull(),
  status: text("status", { enum: chargeStatuses }).notNull().default("PENDING"),
  paymentProvider: text("payment_provider", { enum: paymentProviders }).notNull(),
  txid: text("txid").notNull().unique(),
  externalId: text("external_id"),
  pixQrCodeBase64: text("pix_qr_code_base64"),
  pixCopyPaste: text("pix_copy_paste"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [
  foreignKey({ name: "payment_charges_client_fk", columns: [t.companyId, t.clientId], foreignColumns: [ClientTable.companyId, ClientTable.id] }).onDelete("restrict"),
  uniqueIndex("payment_charges_external_idx").on(t.companyId, t.paymentProvider, t.externalId),
  index("payment_charges_provider_external_lookup_idx").on(t.paymentProvider, t.externalId),
  uniqueIndex("payment_charges_pending_reference_idx").on(t.companyId, t.referenceType, t.referenceId).where(sql`${t.status} = 'PENDING'`),
  check("payment_charges_reference_check", sql`${t.referenceType} in ('ORDER','SUBSCRIPTION','APPOINTMENT_DEPOSIT')`),
  check("payment_charges_method_check", sql`${t.method} in ('PIX_DYNAMIC','PIX_STATIC','CREDIT_CARD')`),
  check("payment_charges_payment_provider_check", sql`${t.paymentProvider} in ('NONE','ASAAS','MERCADO_PAGO','SANDBOX')`),
  check("payment_charges_status_check", sql`${t.status} in ('PENDING','CONFIRMED','EXPIRED','CANCELED') and ${t.amountCents} > 0`),
]);

export const PaymentWebhookEventTable = pgTable("payment_webhook_events", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: onlinePaymentProviders }).notNull(),
  eventId: text("event_id").notNull(),
  chargeId: uuid("charge_id").notNull().references(() => PaymentChargeTable.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.provider, t.eventId] }),
  check("payment_webhook_events_provider_check", sql`${t.provider} in ('ASAAS','MERCADO_PAGO','SANDBOX')`),
]);

export const ClubBenefitUseTable = pgTable("club_benefit_uses", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull(),
  subscriptionId: uuid("subscription_id").notNull().references(() => ClientSubscriptionTable.id, { onDelete: "restrict" }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  quantity: integer("quantity").notNull(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.orderId] }),
  foreignKey({ columns: [t.companyId, t.orderId], foreignColumns: [FinanceOrderTable.companyId, FinanceOrderTable.id] }).onDelete("cascade"),
  index("club_benefit_uses_period_idx").on(t.subscriptionId, t.periodStart),
  check("club_benefit_uses_quantity_check", sql`${t.quantity} > 0`),
]);
