-- Migration 0012: Collaborators team expansion, reviews, awards, schedules, and AI reschedule queue

ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "whatsapp" varchar(30);
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "bio" text;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "default_commission_rate" numeric(5, 2) DEFAULT 0 NOT NULL;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "monthly_revenue_goal" integer;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "hired_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "deactivated_at" timestamp with time zone;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "deactivation_reason" text;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "collaborators" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE INDEX IF NOT EXISTS "collaborators_company_id_idx" ON "collaborators" ("company_id");
CREATE INDEX IF NOT EXISTS "collaborators_status_idx" ON "collaborators" ("company_id", "status");

-- Adiciona custom_commission_rate em collaborator_services
ALTER TABLE "collaborator_services" ADD COLUMN IF NOT EXISTS "custom_commission_rate" numeric(5, 2);

-- Tabela de Jornada Individual
CREATE TABLE IF NOT EXISTS "collaborator_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "collaborator_id" uuid NOT NULL REFERENCES "collaborators"("id") ON DELETE CASCADE,
  "day_of_week" smallint NOT NULL,
  "is_working_day" boolean DEFAULT false NOT NULL,
  "start_time" varchar(5),
  "end_time" varchar(5),
  "break_start_time" varchar(5),
  "break_end_time" varchar(5),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "collaborator_schedules_day_chk" CHECK ("day_of_week" >= 0 AND "day_of_week" <= 6)
);

CREATE UNIQUE INDEX IF NOT EXISTS "collaborator_schedules_company_collab_day_uidx" ON "collaborator_schedules" ("company_id", "collaborator_id", "day_of_week");
CREATE INDEX IF NOT EXISTS "collaborator_schedules_collab_idx" ON "collaborator_schedules" ("company_id", "collaborator_id");

-- Tabela de Avaliações
CREATE TABLE IF NOT EXISTS "collaborator_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "collaborator_id" uuid NOT NULL REFERENCES "collaborators"("id") ON DELETE CASCADE,
  "appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL,
  "client_id" text,
  "client_name" varchar(120) NOT NULL,
  "service_name" varchar(120),
  "rating" integer NOT NULL,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "collaborator_reviews_collab_idx" ON "collaborator_reviews" ("company_id", "collaborator_id");

-- Tabela de Troféus / Funcionário do Mês
CREATE TABLE IF NOT EXISTS "collaborator_awards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "collaborator_id" uuid NOT NULL REFERENCES "collaborators"("id") ON DELETE CASCADE,
  "title" varchar(150) NOT NULL,
  "reference_month" varchar(7) NOT NULL,
  "score" numeric(5, 2) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "collaborator_awards_collab_month_idx" ON "collaborator_awards" ("company_id", "collaborator_id", "reference_month");

-- Tabela de Fila de Reagendamento com IA
CREATE TABLE IF NOT EXISTS "ai_reschedule_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "former_collaborator_id" uuid NOT NULL REFERENCES "collaborators"("id") ON DELETE CASCADE,
  "appointment_id" uuid NOT NULL REFERENCES "appointments"("id") ON DELETE CASCADE,
  "client_id" text,
  "client_name" varchar(120) NOT NULL,
  "client_phone" varchar(30) NOT NULL,
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "original_starts_at" timestamp with time zone NOT NULL,
  "suggested_collaborator_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(30) DEFAULT 'PENDING_AI_AGENT' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "ai_reschedule_queue_company_status_idx" ON "ai_reschedule_queue" ("company_id", "status");
