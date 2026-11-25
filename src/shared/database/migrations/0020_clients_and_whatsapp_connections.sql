CREATE TABLE IF NOT EXISTS "clients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "email" text,
  "birth_date" date,
  "tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "last_visit_at" timestamp with time zone,
  "total_spent_cents" bigint DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_company_phone_unique" ON "clients" ("company_id", "phone");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_company_name_idx" ON "clients" ("company_id", "name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_whatsapp_connections" (
  "company_id" uuid PRIMARY KEY NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "evolution_instance_name" text UNIQUE,
  "evolution_status" varchar(24) DEFAULT 'DISCONNECTED' NOT NULL,
  "evolution_phone_number" text,
  "datafy_enabled" boolean DEFAULT false NOT NULL,
  "datafy_instance_id" text,
  "datafy_api_token_encrypted" text,
  "datafy_status" varchar(24) DEFAULT 'DISCONNECTED' NOT NULL,
  "ai_autopilot_enabled" boolean DEFAULT true NOT NULL,
  "ai_system_prompt" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_whatsapp_evolution_status_chk" CHECK ("evolution_status" IN ('DISCONNECTED', 'QRCODE_PENDING', 'CONNECTED')),
  CONSTRAINT "company_whatsapp_datafy_status_chk" CHECK ("datafy_status" IN ('DISCONNECTED', 'CONNECTED'))
);
