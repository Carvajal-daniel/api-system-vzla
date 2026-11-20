CREATE TABLE "collaborator_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"commission_percentage" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collaborator_services_commission_range_chk" CHECK ("collaborator_services"."commission_percentage" >= 0 AND "collaborator_services"."commission_percentage" <= 100)
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price_in_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_minutes_positive_chk" CHECK ("services"."duration_minutes" > 0),
	CONSTRAINT "services_price_in_cents_non_negative_chk" CHECK ("services"."price_in_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"collaborator_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"is_working_day" boolean DEFAULT false NOT NULL,
	"start_time" varchar(5),
	"end_time" varchar(5),
	"break_start" varchar(5),
	"break_end" varchar(5),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_day_of_week_chk" CHECK ("work_schedules"."day_of_week" >= 0 AND "work_schedules"."day_of_week" <= 6),
	CONSTRAINT "work_schedules_working_hours_chk" CHECK (("work_schedules"."is_working_day" = false AND "work_schedules"."start_time" IS NULL AND "work_schedules"."end_time" IS NULL AND "work_schedules"."break_start" IS NULL AND "work_schedules"."break_end" IS NULL) OR ("work_schedules"."is_working_day" = true AND "work_schedules"."start_time" IS NOT NULL AND "work_schedules"."end_time" IS NOT NULL AND "work_schedules"."end_time" > "work_schedules"."start_time")),
	CONSTRAINT "work_schedules_break_hours_chk" CHECK (("work_schedules"."break_start" IS NULL AND "work_schedules"."break_end" IS NULL) OR ("work_schedules"."break_start" IS NOT NULL AND "work_schedules"."break_end" IS NOT NULL AND "work_schedules"."break_start" > "work_schedules"."start_time" AND "work_schedules"."break_end" > "work_schedules"."break_start" AND "work_schedules"."break_end" < "work_schedules"."end_time"))
);
--> statement-breakpoint
ALTER TABLE "collaborator_services" ADD CONSTRAINT "collaborator_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborator_services" ADD CONSTRAINT "collaborator_services_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collaborator_services" ADD CONSTRAINT "collaborator_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collaborator_services_company_collab_service_uidx" ON "collaborator_services" USING btree ("company_id","collaborator_id","service_id");--> statement-breakpoint
CREATE INDEX "collaborator_services_company_service_idx" ON "collaborator_services" USING btree ("company_id","service_id");--> statement-breakpoint
CREATE INDEX "collaborator_services_company_collab_idx" ON "collaborator_services" USING btree ("company_id","collaborator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_company_normalized_name_uidx" ON "services" USING btree ("company_id",lower(btrim("name")));--> statement-breakpoint
CREATE INDEX "services_company_active_idx" ON "services" USING btree ("company_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "work_schedules_company_collab_day_uidx" ON "work_schedules" USING btree ("company_id","collaborator_id","day_of_week");--> statement-breakpoint
CREATE INDEX "work_schedules_company_collab_idx" ON "work_schedules" USING btree ("company_id","collaborator_id");