CREATE TABLE "financial_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"appointment_id" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"net_in_cents" integer NOT NULL,
	"generated_commission_in_cents" integer,
	"commission_paid_at" timestamp with time zone,
	"commission_paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_documents_company_appointment_unique" UNIQUE("company_id","appointment_id"),
	CONSTRAINT "financial_documents_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "financial_documents_amounts_check" CHECK ("financial_documents"."net_in_cents" >= 0 and "financial_documents"."generated_commission_in_cents" between 0 and "financial_documents"."net_in_cents"),
	CONSTRAINT "financial_documents_currency_check" CHECK ("financial_documents"."currency" in ('BRL', 'USD')),
	CONSTRAINT "financial_documents_settled_check" CHECK (("financial_documents"."commission_paid_at" is null) = ("financial_documents"."commission_paid_by" is null))
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"amount_in_cents" integer NOT NULL,
	"method" varchar(16) NOT NULL,
	"effective_on" date NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"position" smallint NOT NULL,
	"reverses_receipt_id" uuid,
	"reason" text,
	CONSTRAINT "receipts_company_request_position_unique" UNIQUE("company_id","request_key","position"),
	CONSTRAINT "receipts_company_document_id_unique" UNIQUE("company_id","document_id","id"),
	CONSTRAINT "receipts_amount_check" CHECK ("receipts"."amount_in_cents" > 0 and "receipts"."position" between 0 and 1),
	CONSTRAINT "receipts_method_check" CHECK ("receipts"."method" in ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER')),
	CONSTRAINT "receipts_reversal_reason_check" CHECK ((
    ("receipts"."reverses_receipt_id" is null and "receipts"."reason" is null) or
    ("receipts"."reverses_receipt_id" is not null and "receipts"."reason" is not null and length(trim("receipts"."reason")) between 1 and 500)
  ))
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "operating_days" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "operating_schedule" jsonb;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "currency" varchar(3) DEFAULT 'BRL' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "finance_opened_on" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "image_url" text;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_company_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_company_appointment_fk" FOREIGN KEY ("company_id","appointment_id") REFERENCES "public"."appointments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_document_fk" FOREIGN KEY ("company_id","document_id") REFERENCES "public"."financial_documents"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_document_original_fk" FOREIGN KEY ("company_id","document_id","reverses_receipt_id") REFERENCES "public"."receipts"("company_id","document_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_company_effective_idx" ON "receipts" USING btree ("company_id","effective_on");--> statement-breakpoint
CREATE INDEX "receipts_company_document_idx" ON "receipts" USING btree ("company_id","document_id");--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_currency_check" CHECK ("companies"."currency" in ('BRL', 'USD'));
--> statement-breakpoint
UPDATE "companies" AS company
SET "currency" = CASE
  WHEN "monthly_goal_in_cents" > 0 AND "monthly_goal_currency" IN ('BRL', 'USD') THEN "monthly_goal_currency"
  ELSE 'BRL'
END,
"finance_opened_on" = (CURRENT_TIMESTAMP AT TIME ZONE
  CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = company.timezone)
    THEN company.timezone ELSE 'UTC' END)::date;
