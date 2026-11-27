ALTER TABLE companies
  ADD COLUMN saas_plan text NOT NULL DEFAULT 'PRO' CONSTRAINT companies_saas_plan_check CHECK (saas_plan IN ('ESSENTIAL', 'PRO', 'SCALE')),
  ADD COLUMN has_official_api_addon boolean NOT NULL DEFAULT false,
  ADD COLUMN saas_status text NOT NULL DEFAULT 'TRIAL' CONSTRAINT companies_saas_status_check CHECK (saas_status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
  ADD COLUMN monthly_ai_quota integer NOT NULL DEFAULT 400 CONSTRAINT companies_monthly_ai_quota_check CHECK (monthly_ai_quota >= 0);
--> statement-breakpoint
CREATE TABLE subscription_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  allowed_days_of_week integer[],
  grace_period_days integer NOT NULL DEFAULT 3,
  PRIMARY KEY (company_id, id),
  CONSTRAINT subscription_plans_allowed_days_check CHECK (array_position(allowed_days_of_week, NULL) IS NULL AND allowed_days_of_week <@ ARRAY[0,1,2,3,4,5,6]),
  CONSTRAINT subscription_plans_grace_period_check CHECK (grace_period_days >= 0)
);
--> statement-breakpoint
CREATE TABLE club_subscriptions (
  company_id uuid NOT NULL,
  client_phone text NOT NULL,
  plan_id uuid NOT NULL,
  status text NOT NULL,
  due_at timestamptz,
  PRIMARY KEY (company_id, client_phone),
  FOREIGN KEY (company_id, plan_id) REFERENCES subscription_plans(company_id, id) ON DELETE CASCADE,
  CONSTRAINT club_subscriptions_status_check CHECK (status IN ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED'))
);
--> statement-breakpoint
ALTER TABLE appointments
  ADD COLUMN club_full_price_in_cents integer,
  ADD COLUMN is_guest boolean NOT NULL DEFAULT false,
  ADD COLUMN uses_club_benefit boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX appointments_company_client_future_idx
  ON appointments (company_id, client_phone, starts_at)
  WHERE status IN ('PENDING', 'CONFIRMED') AND NOT is_guest;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE appointments ADD CONSTRAINT appointments_active_slot_exclusion
  EXCLUDE USING gist (company_id WITH =, collaborator_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'));
--> statement-breakpoint
CREATE TABLE saas_telemetry_events (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  ai_turns_l0 bigint NOT NULL DEFAULT 0,
  ai_turns_l1 bigint NOT NULL DEFAULT 0,
  ai_turns_l2 bigint NOT NULL DEFAULT 0,
  tokens_input bigint NOT NULL DEFAULT 0,
  tokens_output bigint NOT NULL DEFAULT 0,
  appointments_created_by_ai bigint NOT NULL DEFAULT 0,
  appointments_created_manual bigint NOT NULL DEFAULT 0,
  active_club_subscribers bigint,
  gmv_cents bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, date)
);
--> statement-breakpoint
LOCK TABLE finance_orders IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
INSERT INTO saas_telemetry_events (company_id, date, gmv_cents)
SELECT company_id, order_date, sum(total_cents)
FROM finance_orders
WHERE status = 'CLOSED'
GROUP BY company_id, order_date;
--> statement-breakpoint
CREATE FUNCTION update_saas_gmv_from_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_order finance_orders%ROWTYPE;
  new_order finance_orders%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'CLOSED' THEN old_order := OLD; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'CLOSED' THEN new_order := NEW; END IF;

  INSERT INTO saas_telemetry_events (company_id, date, gmv_cents)
  SELECT company_id, order_date, sum(delta)
  FROM (VALUES
    (old_order.company_id, old_order.order_date, -old_order.total_cents::bigint),
    (new_order.company_id, new_order.order_date, new_order.total_cents::bigint)
  ) AS changes(company_id, order_date, delta)
  WHERE company_id IS NOT NULL
  GROUP BY company_id, order_date
  HAVING sum(delta) <> 0
  ORDER BY company_id, order_date
  ON CONFLICT (company_id, date) DO UPDATE
  SET gmv_cents = saas_telemetry_events.gmv_cents + excluded.gmv_cents;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER finance_orders_saas_gmv
AFTER INSERT OR UPDATE OF status, total_cents, order_date, company_id OR DELETE ON finance_orders
FOR EACH ROW EXECUTE FUNCTION update_saas_gmv_from_order();
--> statement-breakpoint
CREATE FUNCTION update_saas_club_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tenant uuid;
  local_day date;
BEGIN
  tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  PERFORM pg_advisory_xact_lock(hashtext('club-snapshot:' || tenant::text));
  SELECT (clock_timestamp() AT TIME ZONE timezone)::date INTO local_day FROM companies WHERE id = tenant;
  IF local_day IS NULL THEN RETURN NULL; END IF;

  INSERT INTO saas_telemetry_events (company_id, date, active_club_subscribers)
  SELECT tenant, local_day, count(*) FROM club_subscriptions WHERE company_id = tenant AND status = 'ACTIVE'
  ON CONFLICT (company_id, date) DO UPDATE
  SET active_club_subscribers = excluded.active_club_subscribers;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER club_subscriptions_saas_snapshot
AFTER INSERT OR UPDATE OF status OR DELETE ON club_subscriptions
FOR EACH ROW EXECUTE FUNCTION update_saas_club_snapshot();
