CREATE TABLE "client_profile_fields" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "client_id" text NOT NULL,
  "values" jsonb NOT NULL,
  PRIMARY KEY ("company_id", "client_id")
);
--> statement-breakpoint
CREATE TABLE "password_reset_challenges" (
  "key" text PRIMARY KEY,
  "account_id" uuid NOT NULL,
  "role" text NOT NULL,
  "digest" text NOT NULL,
  "attempts" integer NOT NULL DEFAULT 0,
  "expires_at" timestamptz NOT NULL,
  "issued_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "password_reset_expiry_idx" ON "password_reset_challenges" ("expires_at");
--> statement-breakpoint
CREATE TABLE "password_reset_rate_limits" (
  "key" text PRIMARY KEY,
  "requests" integer NOT NULL,
  "expires_at" timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX "password_reset_rate_expiry_idx" ON "password_reset_rate_limits" ("expires_at");
