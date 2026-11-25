CREATE TABLE IF NOT EXISTS "tenant_whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"provider" varchar(24) NOT NULL,
	"purpose" varchar(24) DEFAULT 'ALL' NOT NULL,
	"phone_number" varchar(32),
	"status" varchar(24) DEFAULT 'DISCONNECTED' NOT NULL,
	"credentials" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_whatsapp_channels_provider_chk" CHECK ("provider" IN ('EVOLUTION', 'META_OFFICIAL')),
	CONSTRAINT "tenant_whatsapp_channels_purpose_chk" CHECK ("purpose" IN ('ALL', 'RECEPTION_ONLY', 'CAMPAIGNS_ONLY')),
	CONSTRAINT "tenant_whatsapp_channels_status_chk" CHECK ("status" IN ('CONNECTED', 'DISCONNECTED', 'QRCODE_PENDING'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_whatsapp_channels_tenant_status_idx" ON "tenant_whatsapp_channels" ("tenant_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_whatsapp_channels_provider_phone_unique" ON "tenant_whatsapp_channels" ("provider", "phone_number") WHERE "phone_number" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_usage_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"period_month" varchar(7) NOT NULL,
	"ai_sessions_count" integer DEFAULT 0 NOT NULL,
	"outbound_messages_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_usage_metrics_period_format_chk" CHECK ("period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "tenant_usage_metrics_counters_non_negative_chk" CHECK ("ai_sessions_count" >= 0 AND "outbound_messages_count" >= 0 AND "total_input_tokens" >= 0 AND "total_output_tokens" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_usage_metrics_tenant_period_unique" ON "tenant_usage_metrics" ("tenant_id", "period_month");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"feature" varchar(32) NOT NULL,
	"model" varchar(120) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_logs_feature_chk" CHECK ("feature" IN ('BOOKING', 'COPILOT', 'RETENTION', 'INSIGHTS', 'MODULE_ANALYSIS')),
	CONSTRAINT "ai_usage_logs_tokens_non_negative_chk" CHECK ("prompt_tokens" >= 0 AND "completion_tokens" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_logs_tenant_created_idx" ON "ai_usage_logs" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_proactive_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
	"module" varchar(24) NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"impact_label" varchar(80),
	"action_payload" jsonb,
	"status" varchar(24) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_proactive_insights_module_chk" CHECK ("module" IN ('WHATSAPP', 'AGENDA', 'FINANCE', 'CLIENTS', 'SERVICES', 'INVENTORY', 'TEAM')),
	CONSTRAINT "ai_proactive_insights_status_chk" CHECK ("status" IN ('PENDING', 'EXECUTED', 'DISMISSED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proactive_insights_tenant_status_created_idx" ON "ai_proactive_insights" ("tenant_id", "status", "created_at");
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "ai_paused_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "last_ai_session_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "hourly_message_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD COLUMN IF NOT EXISTS "hourly_window_start_at" timestamp with time zone;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'whatsapp_conversations_hourly_count_non_negative_chk'
	) THEN
		ALTER TABLE "whatsapp_conversations"
			ADD CONSTRAINT "whatsapp_conversations_hourly_count_non_negative_chk"
			CHECK ("hourly_message_count" >= 0);
	END IF;
END $$;
