
ALTER TABLE subscription_plans
  ADD COLUMN description text,
  ADD COLUMN price_cents integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  ADD COLUMN billing_cycle text NOT NULL DEFAULT 'MONTHLY' CHECK (billing_cycle = 'MONTHLY'),
  ADD COLUMN included_service_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN max_monthly_uses integer CHECK (max_monthly_uses >= 0),
  ADD COLUMN active boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE clients ADD CONSTRAINT clients_company_id_unique UNIQUE (company_id, id);
--> statement-breakpoint
CREATE TABLE company_payment_configs (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  payment_provider text NOT NULL DEFAULT 'NONE' CHECK (payment_provider IN ('NONE','ASAAS','SANDBOX')),
  provider_api_key_encrypted text,
  webhook_token_encrypted text,
  static_pix_key text
);
--> statement-breakpoint
CREATE TABLE client_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','ACTIVE','PAST_DUE','SUSPENDED','CANCELED')),
  payment_method text NOT NULL CHECK (payment_method IN ('PIX','CREDIT_CARD')),
  payment_provider text NOT NULL CHECK (payment_provider IN ('ASAAS','SANDBOX')),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  external_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  next_billing_date date NOT NULL,
  CONSTRAINT client_subscriptions_client_fk FOREIGN KEY (company_id, client_id) REFERENCES clients(company_id, id) ON DELETE CASCADE,
  CONSTRAINT client_subscriptions_plan_fk FOREIGN KEY (company_id, plan_id) REFERENCES subscription_plans(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT client_subscriptions_period_check CHECK (
    (current_period_start IS NULL AND current_period_end IS NULL) OR
    (current_period_start IS NOT NULL AND current_period_end IS NOT NULL AND current_period_end > current_period_start)
  )
);
CREATE UNIQUE INDEX client_subscriptions_current_idx ON client_subscriptions(company_id, client_id) WHERE status <> 'CANCELED';
CREATE UNIQUE INDEX client_subscriptions_external_idx ON client_subscriptions(company_id, payment_provider, external_subscription_id);
CREATE INDEX client_subscriptions_status_idx ON client_subscriptions(company_id, status);
--> statement-breakpoint
CREATE TABLE payment_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  reference_type text NOT NULL CHECK (reference_type IN ('ORDER','SUBSCRIPTION','APPOINTMENT_DEPOSIT')),
  reference_id uuid NOT NULL,
  client_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('PIX_DYNAMIC','PIX_STATIC','CREDIT_CARD')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','EXPIRED','CANCELED')),
  payment_provider text NOT NULL CHECK (payment_provider IN ('NONE','ASAAS','SANDBOX')),
  txid text NOT NULL UNIQUE,
  external_id text,
  pix_qr_code_base64 text,
  pix_copy_paste text,
  expires_at timestamptz,
  paid_at timestamptz,
  CONSTRAINT payment_charges_client_fk FOREIGN KEY (company_id, client_id) REFERENCES clients(company_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX payment_charges_external_idx ON payment_charges(company_id, payment_provider, external_id);
CREATE UNIQUE INDEX payment_charges_pending_reference_idx ON payment_charges(company_id, reference_type, reference_id) WHERE status = 'PENDING';
CREATE INDEX payment_charges_provider_external_lookup_idx ON payment_charges(payment_provider, external_id);
--> statement-breakpoint
CREATE TABLE payment_webhook_events (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('ASAAS','SANDBOX')),
  event_id text NOT NULL,
  charge_id uuid NOT NULL REFERENCES payment_charges(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, provider, event_id)
);
--> statement-breakpoint
CREATE TABLE club_benefit_uses (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  subscription_id uuid NOT NULL REFERENCES client_subscriptions(id) ON DELETE RESTRICT,
  period_start timestamptz NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (company_id, order_id),
  FOREIGN KEY (company_id, order_id) REFERENCES finance_orders(company_id, id) ON DELETE CASCADE
);
CREATE INDEX club_benefit_uses_period_idx ON club_benefit_uses(subscription_id, period_start);
--> statement-breakpoint
CREATE FUNCTION count_active_club_subscribers(tenant uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT count(*) FROM (
    SELECT client.phone FROM client_subscriptions subscription
    JOIN clients client ON client.company_id = tenant AND client.id = subscription.client_id
    WHERE subscription.company_id = tenant AND subscription.status = 'ACTIVE' AND subscription.current_period_end > now()
    UNION
    SELECT legacy.client_phone FROM club_subscriptions legacy
    WHERE legacy.company_id = tenant AND legacy.status = 'ACTIVE' AND NOT EXISTS (
      SELECT 1 FROM client_subscriptions subscription
      JOIN clients client ON client.company_id = tenant AND client.id = subscription.client_id
      WHERE subscription.company_id = tenant AND client.phone = legacy.client_phone AND subscription.status <> 'PENDING_PAYMENT'
    )
  ) active;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION update_saas_club_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tenant uuid;
  local_day date;
BEGIN
  tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  PERFORM pg_advisory_xact_lock(hashtext('club-snapshot:' || tenant::text));
  SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO local_day FROM companies WHERE id = tenant;
  IF local_day IS NULL THEN RETURN NULL; END IF;
  INSERT INTO saas_telemetry_events (company_id, date, active_club_subscribers)
  VALUES (tenant, local_day, count_active_club_subscribers(tenant))
  ON CONFLICT (company_id, date) DO UPDATE
  SET active_club_subscribers = excluded.active_club_subscribers;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER client_subscriptions_saas_snapshot
AFTER INSERT OR UPDATE OF status OR DELETE ON client_subscriptions
FOR EACH ROW EXECUTE FUNCTION update_saas_club_snapshot();
