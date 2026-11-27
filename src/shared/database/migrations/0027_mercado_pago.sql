
ALTER TABLE company_payment_configs
  DROP CONSTRAINT company_payment_configs_payment_provider_check,
  ADD CONSTRAINT company_payment_provider_check CHECK (payment_provider IN ('NONE','ASAAS','MERCADO_PAGO','SANDBOX'));
--> statement-breakpoint
ALTER TABLE client_subscriptions
  ADD COLUMN checkout_url text,
  DROP CONSTRAINT client_subscriptions_payment_provider_check,
  ADD CONSTRAINT client_subscriptions_payment_provider_check CHECK (payment_provider IN ('ASAAS','MERCADO_PAGO','SANDBOX'));
--> statement-breakpoint
ALTER TABLE payment_charges
  DROP CONSTRAINT payment_charges_payment_provider_check,
  ADD CONSTRAINT payment_charges_payment_provider_check CHECK (payment_provider IN ('NONE','ASAAS','MERCADO_PAGO','SANDBOX'));
--> statement-breakpoint
ALTER TABLE payment_webhook_events
  DROP CONSTRAINT payment_webhook_events_provider_check,
  ADD CONSTRAINT payment_webhook_events_provider_check CHECK (provider IN ('ASAAS','MERCADO_PAGO','SANDBOX'));
