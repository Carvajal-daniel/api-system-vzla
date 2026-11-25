CREATE TABLE IF NOT EXISTS "whatsapp_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "phone" text NOT NULL,
  "contact_name" text,
  "status" varchar(24) DEFAULT 'OPEN' NOT NULL,
  "assigned_mode" varchar(24) DEFAULT 'AI_AUTOPILOT' NOT NULL,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_conversations_status_chk" CHECK ("status" IN ('OPEN', 'WAITING_CLIENT', 'CONVERTED', 'ARCHIVED')),
  CONSTRAINT "whatsapp_conversations_assigned_mode_chk" CHECK ("assigned_mode" IN ('AI_AUTOPILOT', 'HUMAN')),
  CONSTRAINT "whatsapp_conversations_unread_non_negative_chk" CHECK ("unread_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_conversations_company_phone_unique" ON "whatsapp_conversations" ("company_id", "phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_conversations_company_last_message_idx" ON "whatsapp_conversations" ("company_id", "last_message_at" DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "conversation_id" uuid NOT NULL REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE,
  "external_message_id" text,
  "direction" varchar(16) NOT NULL,
  "sender_type" varchar(16) NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "whatsapp_messages_direction_chk" CHECK ("direction" IN ('INBOUND', 'OUTBOUND')),
  CONSTRAINT "whatsapp_messages_sender_type_chk" CHECK ("sender_type" IN ('CLIENT', 'AI_AGENT', 'OWNER'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_company_external_id_unique" ON "whatsapp_messages" ("company_id", "external_message_id") WHERE "external_message_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_messages_company_conversation_sent_idx" ON "whatsapp_messages" ("company_id", "conversation_id", "sent_at");
