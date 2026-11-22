CREATE TABLE "company_settings" (
  "company_id" uuid PRIMARY KEY REFERENCES "companies"("id") ON DELETE CASCADE,
  "preferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "appearance" jsonb
);
--> statement-breakpoint
CREATE TABLE "company_surveys" (
  "appointment_id" uuid PRIMARY KEY REFERENCES "appointments"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "token" text NOT NULL UNIQUE,
  "submitted_at" timestamptz
);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_currency_check";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_check" CHECK ("currency" IN ('BRL', 'USD', 'VES'));
--> statement-breakpoint
ALTER TABLE "financial_documents" DROP CONSTRAINT IF EXISTS "financial_documents_currency_check";
--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_currency_check" CHECK ("currency" IN ('BRL', 'USD', 'VES'));
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "client_data" jsonb, ADD COLUMN "cancellation_digest" text;
