CREATE TABLE "commission_deduction_applications" (
	"company_id" uuid NOT NULL,
	"deduction_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "commission_deduction_applications_unique" UNIQUE("company_id","deduction_id","settlement_id"),
	CONSTRAINT "commission_deduction_applications_amount_check" CHECK ("commission_deduction_applications"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "commission_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"description" text NOT NULL,
	"category" varchar(20) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_amount_cents" integer,
	"amount_cents" integer NOT NULL,
	"deducted_at" date NOT NULL,
	"notes" text,
	"settlement_id" uuid,
	"external_source_type" varchar(40),
	"external_source_id" varchar(128),
	"request_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_deductions_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "commission_deductions_company_source_unique" UNIQUE("company_id","external_source_type","external_source_id"),
	CONSTRAINT "commission_deductions_company_request_unique" UNIQUE("company_id","request_key"),
	CONSTRAINT "commission_deductions_category_check" CHECK ("commission_deductions"."category" in ('STOCK_PRODUCT','ADVANCE','OTHER')),
	CONSTRAINT "commission_deductions_amount_check" CHECK ("commission_deductions"."amount_cents" > 0 and "commission_deductions"."quantity" > 0 and
    ("commission_deductions"."unit_amount_cents" is null or ("commission_deductions"."unit_amount_cents" > 0 and "commission_deductions"."amount_cents" = "commission_deductions"."quantity"::bigint * "commission_deductions"."unit_amount_cents"))),
	CONSTRAINT "commission_deductions_source_check" CHECK (("commission_deductions"."external_source_type" is null) = ("commission_deductions"."external_source_id" is null))
);
--> statement-breakpoint
ALTER TABLE "commission_settlements" DROP CONSTRAINT "commission_settlements_amount_check";--> statement-breakpoint
ALTER TABLE "commission_deduction_applications" ADD CONSTRAINT "commission_deduction_applications_deduction_fk" FOREIGN KEY ("company_id","deduction_id") REFERENCES "public"."commission_deductions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_deduction_applications" ADD CONSTRAINT "commission_deduction_applications_settlement_fk" FOREIGN KEY ("company_id","settlement_id") REFERENCES "public"."commission_settlements"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_deductions" ADD CONSTRAINT "commission_deductions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_deductions" ADD CONSTRAINT "commission_deductions_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_deductions" ADD CONSTRAINT "commission_deductions_settlement_fk" FOREIGN KEY ("company_id","settlement_id") REFERENCES "public"."commission_settlements"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_deduction_applications_settlement_idx" ON "commission_deduction_applications" USING btree ("company_id","settlement_id");--> statement-breakpoint
CREATE INDEX "commission_deductions_company_person_date_idx" ON "commission_deductions" USING btree ("company_id","collaborator_id","deducted_at");--> statement-breakpoint
ALTER TABLE "commission_settlements" ADD CONSTRAINT "commission_settlements_amount_check" CHECK ("commission_settlements"."amount_cents" >= 0);--> statement-breakpoint
INSERT INTO "financial_documents" (
  "company_id", "appointment_id", "currency", "net_in_cents", "generated_commission_in_cents"
)
SELECT appointment."company_id", appointment."id", company."currency", appointment."service_price_in_cents_snapshot",
  round(appointment."service_price_in_cents_snapshot"::numeric * appointment."commission_percentage_snapshot" / 100)
FROM "appointments" AS appointment
JOIN "companies" AS company ON company."id" = appointment."company_id"
WHERE appointment."status" = 'COMPLETED'
ON CONFLICT ("company_id", "appointment_id") DO UPDATE
SET "generated_commission_in_cents" = EXCLUDED."generated_commission_in_cents"
WHERE "financial_documents"."generated_commission_in_cents" IS NULL;
