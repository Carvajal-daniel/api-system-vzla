-- Migration 0013: Company configurable ranking weights and unique monthly award constraint

ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "ranking_weights" jsonb
  DEFAULT '{"servicesRevenueWeight":35,"productsSalesWeight":25,"appointmentsVolumeWeight":15,"clientReviewsWeight":15,"punctualityRetentionWeight":10}'::jsonb
  NOT NULL;

-- Garante que apenas 1 Funcionário do Mês oficial seja registrado por empresa em cada reference_month
CREATE UNIQUE INDEX IF NOT EXISTS "collaborator_awards_company_month_uidx"
  ON "collaborator_awards" ("company_id", "reference_month");
