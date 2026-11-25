CREATE TABLE IF NOT EXISTS "ai_conversation_insights" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "lead_temperature" varchar(16) DEFAULT 'WARM' NOT NULL,
  "lead_score" integer DEFAULT 50 NOT NULL,
  "summary" text NOT NULL,
  "detected_objection" varchar(24) DEFAULT 'NONE' NOT NULL,
  "recommended_next_action" text NOT NULL,
  "suggested_followup_reply" text NOT NULL,
  "analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_conversation_insights_temperature_chk" CHECK ("lead_temperature" IN ('HOT', 'WARM', 'COLD')),
  CONSTRAINT "ai_conversation_insights_score_chk" CHECK ("lead_score" >= 0 AND "lead_score" <= 100),
  CONSTRAINT "ai_conversation_insights_objection_chk" CHECK ("detected_objection" IN ('NONE', 'TIMING', 'SCHEDULE_FULL', 'PRICE', 'PAYMENT_METHOD', 'OTHER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversation_insights_company_conversation_unique" ON "ai_conversation_insights" ("company_id", "conversation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversation_insights_conversation_unique" ON "ai_conversation_insights" ("conversation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversation_insights_company_temp_updated_idx" ON "ai_conversation_insights" ("company_id", "lead_temperature", "updated_at" DESC);
