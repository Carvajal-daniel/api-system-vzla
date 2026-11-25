ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "reminder_2h_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "nps_sent_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "nps_responded_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_reminders_lookup_idx" ON "appointments" ("company_id", "status", "starts_at") WHERE "status" IN ('PENDING', 'CONFIRMED');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "appointments_nps_lookup_idx" ON "appointments" ("company_id", "status", "completed_at") WHERE "status" = 'COMPLETED' AND "completed_at" IS NOT NULL;
