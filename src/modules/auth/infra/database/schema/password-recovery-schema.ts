import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const PasswordResetChallenge = pgTable("password_reset_challenges", {
  key: text("key").primaryKey(), accountId: uuid("account_id").notNull(), role: text("role").notNull(),
  digest: text("digest").notNull(), attempts: integer("attempts").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
}, (table) => [index("password_reset_expiry_idx").on(table.expiresAt)]);

export const PasswordResetRateLimit = pgTable("password_reset_rate_limits", {
  key: text("key").primaryKey(), requests: integer("requests").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [index("password_reset_rate_expiry_idx").on(table.expiresAt)]);
