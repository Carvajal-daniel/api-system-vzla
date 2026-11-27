ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "google_review_url" text,
  ADD COLUMN IF NOT EXISTS "enable_post_visit_survey" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "collaborator_id" uuid REFERENCES "collaborators"("id") ON DELETE set null,
  "desired_date" date NOT NULL,
  "preferred_shift" varchar(16) DEFAULT 'ANY' NOT NULL,
  "status" varchar(16) DEFAULT 'WAITING' NOT NULL,
  "notified_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "waitlist_entries_shift_check" CHECK ("preferred_shift" IN ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')),
  CONSTRAINT "waitlist_entries_status_check" CHECK ("status" IN ('WAITING', 'NOTIFIED', 'CONVERTED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_entries_company_date_status_idx"
  ON "waitlist_entries" ("company_id", "desired_date", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_entries_status_expires_idx"
  ON "waitlist_entries" ("status", "expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "post_visit_surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "appointment_id" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE cascade,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE cascade,
  "score" integer,
  "feedback_text" text,
  "status" varchar(24) DEFAULT 'PENDING_SEND' NOT NULL,
  "scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  "answered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "post_visit_surveys_score_check" CHECK ("score" IS NULL OR ("score" >= 1 AND "score" <= 5)),
  CONSTRAINT "post_visit_surveys_status_check" CHECK ("status" IN ('PENDING_SEND', 'SENT', 'ANSWERED', 'ESCALATED_TO_OWNER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "post_visit_surveys_appointment_unique"
  ON "post_visit_surveys" ("appointment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_visit_surveys_company_status_scheduled_idx"
  ON "post_visit_surveys" ("company_id", "status", "scheduled_for");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "post_visit_surveys_company_client_status_idx"
  ON "post_visit_surveys" ("company_id", "client_id", "status", "sent_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "owner_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "type" varchar(32) NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "owner_alerts_type_check" CHECK ("type" IN ('LOW_SURVEY_SCORE', 'COLLABORATOR_EMERGENCY', 'CHURN_OPPORTUNITY', 'AI_HANDOFF'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owner_alerts_company_read_created_idx"
  ON "owner_alerts" ("company_id", "is_read", "created_at");
