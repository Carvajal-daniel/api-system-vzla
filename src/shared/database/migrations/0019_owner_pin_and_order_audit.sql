ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "owner_pin_hash" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_order_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "order_id" uuid NOT NULL,
  "action" varchar(40) NOT NULL,
  "previous_status" varchar(16) NOT NULL,
  "new_status" varchar(16) NOT NULL,
  "reason" text NOT NULL,
  "authorized_by_id" uuid NOT NULL,
  "authorized_by_role" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_order_audit_logs_order_fk" FOREIGN KEY ("company_id", "order_id") REFERENCES "finance_orders"("company_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_order_audit_logs_company_order_idx" ON "finance_order_audit_logs" ("company_id", "order_id", "created_at");
