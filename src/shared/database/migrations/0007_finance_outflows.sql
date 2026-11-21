CREATE TABLE "commission_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_method" varchar(16) NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"notes" text,
	"request_key" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_settlements_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "commission_settlements_company_request_unique" UNIQUE("company_id","request_key"),
	CONSTRAINT "commission_settlements_amount_check" CHECK ("commission_settlements"."amount_cents" > 0),
	CONSTRAINT "commission_settlements_period_check" CHECK ("commission_settlements"."period_start" <= "commission_settlements"."period_end"),
	CONSTRAINT "commission_settlements_method_check" CHECK ("commission_settlements"."payment_method" in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER'))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" varchar(20) NOT NULL,
	"expense_type" varchar(8) NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_date" date NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_method" varchar(16),
	"status" varchar(8) DEFAULT 'PENDING' NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"notes" text,
	"external_source_type" varchar(40),
	"external_source_id" varchar(128),
	"request_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_company_source_unique" UNIQUE("company_id","external_source_type","external_source_id"),
	CONSTRAINT "expenses_company_request_unique" UNIQUE("company_id","request_key"),
	CONSTRAINT "expenses_category_check" CHECK ("expenses"."category" in ('RENT','UTILITIES','MARKETING','MAINTENANCE','STOCK_PURCHASE','OTHER')),
	CONSTRAINT "expenses_type_check" CHECK ("expenses"."expense_type" in ('FIXED','VARIABLE')),
	CONSTRAINT "expenses_positive_check" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_source_check" CHECK (("expenses"."external_source_type" is null) = ("expenses"."external_source_id" is null)),
	CONSTRAINT "expenses_payment_check" CHECK (("expenses"."status" = 'PAID' and "expenses"."paid_at" is not null and "expenses"."payment_method" is not null)
    or ("expenses"."status" in ('PENDING','OVERDUE') and "expenses"."paid_at" is null and "expenses"."payment_method" is null)),
	CONSTRAINT "expenses_method_check" CHECK ("expenses"."payment_method" in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER'))
);
--> statement-breakpoint
ALTER TABLE "financial_documents" ADD COLUMN "commission_settlement_id" uuid;--> statement-breakpoint
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_settlements_company_paid_idx" ON "commission_settlements" USING btree ("company_id","paid_at");--> statement-breakpoint
CREATE INDEX "expenses_company_due_idx" ON "expenses" USING btree ("company_id","due_date");--> statement-breakpoint
CREATE INDEX "expenses_company_paid_idx" ON "expenses" USING btree ("company_id","paid_at");--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_commission_settlement_fk" FOREIGN KEY ("company_id","commission_settlement_id") REFERENCES "public"."commission_settlements"("company_id","id") ON DELETE no action ON UPDATE no action;