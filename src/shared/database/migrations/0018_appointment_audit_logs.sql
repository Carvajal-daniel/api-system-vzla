CREATE TABLE IF NOT EXISTS "appointment_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "appointment_id" uuid NOT NULL,
  "action" varchar(40) NOT NULL,
  "previous_status" varchar(20) NOT NULL,
  "new_status" varchar(20) NOT NULL,
  "reason" text NOT NULL,
  "authorized_by_id" uuid NOT NULL,
  "authorized_by_name" text NOT NULL,
  "authorized_by_role" varchar(20) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appointment_audit_logs_appointment_fk" FOREIGN KEY ("company_id", "appointment_id") REFERENCES "appointments"("company_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointment_audit_logs_company_appointment_idx" ON "appointment_audit_logs" ("company_id", "appointment_id", "created_at");
