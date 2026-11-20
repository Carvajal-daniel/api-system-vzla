CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"client_phone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"cancellation_reason" text,
	"service_name_snapshot" text NOT NULL,
	"service_price_in_cents_snapshot" integer NOT NULL,
	"service_duration_minutes_snapshot" integer NOT NULL,
	"commission_percentage_snapshot" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_time_range_chk" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_duration_positive_chk" CHECK ("appointments"."service_duration_minutes_snapshot" > 0),
	CONSTRAINT "appointments_price_non_negative_chk" CHECK ("appointments"."service_price_in_cents_snapshot" >= 0),
	CONSTRAINT "appointments_commission_range_chk" CHECK ("appointments"."commission_percentage_snapshot" >= 0 AND "appointments"."commission_percentage_snapshot" <= 100),
	CONSTRAINT "appointments_status_chk" CHECK ("appointments"."status" IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW'))
);
--> statement-breakpoint
CREATE TABLE "schedule_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_blocks_time_range_chk" CHECK ("schedule_blocks"."ends_at" > "schedule_blocks"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "timezone" varchar(64) DEFAULT 'America/Caracas' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_blocks" ADD CONSTRAINT "schedule_blocks_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_company_collab_range_idx" ON "appointments" USING btree ("company_id","collaborator_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "appointments_company_starts_at_idx" ON "appointments" USING btree ("company_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_company_status_starts_at_idx" ON "appointments" USING btree ("company_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "schedule_blocks_company_range_idx" ON "schedule_blocks" USING btree ("company_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "schedule_blocks_company_collab_range_idx" ON "schedule_blocks" USING btree ("company_id","collaborator_id","starts_at","ends_at");