CREATE TABLE "import_batches" (
	"company_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"request_key" uuid NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"imported" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_company_kind_request_unique" UNIQUE("company_id","kind","request_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sku" text,
	"category" varchar(20) NOT NULL,
	"unit" varchar(8) NOT NULL,
	"current_stock" integer DEFAULT 0 NOT NULL,
	"min_stock" integer DEFAULT 0 NOT NULL,
	"cost_price_cents" integer NOT NULL,
	"sale_price_cents" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_items_stock_check" CHECK ("inventory_items"."current_stock" >= 0 and "inventory_items"."min_stock" >= 0),
	CONSTRAINT "inventory_items_prices_check" CHECK ("inventory_items"."cost_price_cents" >= 0 and "inventory_items"."sale_price_cents" >= 0),
	CONSTRAINT "inventory_items_category_check" CHECK ("inventory_items"."category" in ('RESALE_PRODUCT','INTERNAL_SUPPLY')),
	CONSTRAINT "inventory_items_unit_check" CHECK ("inventory_items"."unit" in ('UN','ML','G','BOX','OTHER'))
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"movement_type" varchar(32) NOT NULL,
	"quantity" integer NOT NULL,
	"stock_delta" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"unit_sale_cents" integer,
	"total_amount_cents" integer NOT NULL,
	"collaborator_id" uuid,
	"payment_method" varchar(16),
	"notes" text,
	"finance_reference_type" varchar(24),
	"finance_reference_id" uuid,
	"request_key" uuid,
	"fingerprint" text,
	"reverses_movement_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_company_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "inventory_movements_request_unique" UNIQUE("company_id","request_key"),
	CONSTRAINT "inventory_movements_reversal_unique" UNIQUE("company_id","reverses_movement_id"),
	CONSTRAINT "inventory_movements_quantity_check" CHECK ("inventory_movements"."quantity" > 0 and abs("inventory_movements"."stock_delta"::bigint) = "inventory_movements"."quantity"),
	CONSTRAINT "inventory_movements_prices_check" CHECK ("inventory_movements"."unit_cost_cents" >= 0 and
    ("inventory_movements"."unit_sale_cents" is null or "inventory_movements"."unit_sale_cents" >= 0) and "inventory_movements"."total_amount_cents" >= 0),
	CONSTRAINT "inventory_movements_type_check" CHECK ("inventory_movements"."movement_type" in
    ('PURCHASE_IN','SALE_OUT','COLLABORATOR_WITHDRAWAL','INTERNAL_CONSUMPTION','ADJUSTMENT')),
	CONSTRAINT "inventory_movements_reference_check" CHECK (("inventory_movements"."finance_reference_type" is null) = ("inventory_movements"."finance_reference_id" is null)),
	CONSTRAINT "inventory_movements_sale_check" CHECK (("inventory_movements"."movement_type" = 'SALE_OUT') = ("inventory_movements"."payment_method" is not null)
    and ("inventory_movements"."payment_method" is null or "inventory_movements"."payment_method" in ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER')))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_collaborator_id_collaborators_id_fk" FOREIGN KEY ("collaborator_id") REFERENCES "public"."collaborators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_fk" FOREIGN KEY ("company_id","item_id") REFERENCES "public"."inventory_items"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reversal_fk" FOREIGN KEY ("company_id","reverses_movement_id") REFERENCES "public"."inventory_movements"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_company_sku_unique" ON "inventory_items" USING btree ("company_id",lower("sku"));--> statement-breakpoint
CREATE INDEX "inventory_items_company_active_idx" ON "inventory_items" USING btree ("company_id","is_active","name");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_date_idx" ON "inventory_movements" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_company_item_idx" ON "inventory_movements" USING btree ("company_id","item_id");