ALTER TABLE "expenses" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "unit_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "financial_documents" ADD CONSTRAINT "financial_documents_batch_paid_check" CHECK ("financial_documents"."commission_settlement_id" is null or "financial_documents"."commission_paid_at" is not null);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_quantity_check" CHECK ("expenses"."quantity" >= 1);--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_unit_amount_check" CHECK ((
    ("expenses"."unit_amount_cents" is null and "expenses"."quantity" = 1) or
    ("expenses"."unit_amount_cents" is not null and "expenses"."unit_amount_cents" > 0 and "expenses"."amount_cents" = "expenses"."quantity"::bigint * "expenses"."unit_amount_cents")
  ));