ALTER TABLE "collaborators" ADD COLUMN "specialty" text NOT NULL;--> statement-breakpoint
ALTER TABLE "collaborators" ADD COLUMN "commission_percentage" numeric NOT NULL;--> statement-breakpoint
ALTER TABLE "collaborators" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;