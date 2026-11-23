CREATE TABLE IF NOT EXISTS "finance_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" varchar(40) NOT NULL,
  "appointment_id" uuid REFERENCES "appointments"("id"),
  "client_name" text,
  "client_phone" text,
  "client_document" text,
  "order_date" date NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'OPEN',
  "subtotal_cents" integer NOT NULL,
  "discount_cents" integer NOT NULL DEFAULT 0,
  "total_cents" integer NOT NULL,
  "paid_cents" integer NOT NULL DEFAULT 0,
  "notes" text,
  "request_key" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_orders_company_id_unique" UNIQUE ("company_id", "id"),
  CONSTRAINT "finance_orders_company_request_unique" UNIQUE ("company_id", "request_key"),
  CONSTRAINT "finance_orders_status_check" CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT "finance_orders_amounts_check" CHECK ("subtotal_cents" >= 0 AND "discount_cents" >= 0 AND "total_cents" >= 0 AND "paid_cents" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_orders_company_date_idx" ON "finance_orders" ("company_id", "order_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "order_id" uuid NOT NULL,
  "item_type" varchar(16) NOT NULL,
  "reference_id" uuid,
  "name" text NOT NULL,
  "collaborator_id" uuid REFERENCES "collaborators"("id"),
  "quantity" integer NOT NULL,
  "unit_price_cents" integer NOT NULL,
  "subtotal_cents" integer NOT NULL,
  "commission_percentage" integer NOT NULL DEFAULT 0,
  "commission_cents" integer NOT NULL DEFAULT 0,
  "commission_status" varchar(16) NOT NULL DEFAULT 'NONE',
  "commission_settlement_id" uuid REFERENCES "commission_settlements"("id"),
  "settled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_order_items_order_fk" FOREIGN KEY ("company_id", "order_id") REFERENCES "finance_orders"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "finance_order_items_type_check" CHECK ("item_type" IN ('SERVICE', 'PRODUCT', 'TIP')),
  CONSTRAINT "finance_order_items_qty_check" CHECK ("quantity" > 0 AND "unit_price_cents" >= 0 AND "subtotal_cents" >= 0),
  CONSTRAINT "finance_order_items_commission_check" CHECK ("commission_percentage" BETWEEN 0 AND 100 AND "commission_cents" >= 0),
  CONSTRAINT "finance_order_items_commission_status_check" CHECK ("commission_status" IN ('NONE', 'PENDING', 'PAID'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_order_items_company_order_idx" ON "finance_order_items" ("company_id", "order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_order_items_company_collab_idx" ON "finance_order_items" ("company_id", "collaborator_id", "commission_status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_order_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "order_id" uuid NOT NULL,
  "method" varchar(16) NOT NULL,
  "amount_cents" integer NOT NULL,
  "paid_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_order_payments_order_fk" FOREIGN KEY ("company_id", "order_id") REFERENCES "finance_orders"("company_id", "id") ON DELETE CASCADE,
  CONSTRAINT "finance_order_payments_method_check" CHECK ("method" IN ('CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER')),
  CONSTRAINT "finance_order_payments_amount_check" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "finance_order_payments_company_order_idx" ON "finance_order_payments" ("company_id", "order_id");
