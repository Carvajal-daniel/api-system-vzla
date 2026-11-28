-- Etapa 2 da Fase 4: Pagamentos sem Fricção para o Dono (OAuth Mercado Pago + Subconta Expressa Asaas)
ALTER TABLE "company_payment_configs"
  ADD COLUMN IF NOT EXISTS "provider_refresh_token_encrypted" text,
  ADD COLUMN IF NOT EXISTS "provider_token_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "provider_public_key" text,
  ADD COLUMN IF NOT EXISTS "provider_account_id" text,
  ADD COLUMN IF NOT EXISTS "provider_wallet_id" text,
  ADD COLUMN IF NOT EXISTS "provider_account_label" text;
