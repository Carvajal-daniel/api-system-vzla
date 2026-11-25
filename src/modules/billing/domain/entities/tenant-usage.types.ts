export type PlanTier = "TRIAL" | "PRO" | "ENTERPRISE";

export type AiUsageFeature =
  | "BOOKING"
  | "COPILOT"
  | "RETENTION"
  | "INSIGHTS"
  | "MODULE_ANALYSIS";

export interface PlanLimits {
  tier: PlanTier;
  planName: string;
  aiSessionsLimit: number;
  outboundMessagesLimit: number;
}

export interface TenantUsageMetricsRecord {
  tenantId: string;
  periodMonth: string;
  aiSessionsCount: number;
  outboundMessagesCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  updatedAt: Date;
}

export interface QuotaMetricSummary {
  used: number;
  limit: number;
  percentage: number;
}

export interface UsageSummary {
  planName: string;
  periodMonth: string;
  aiSessions: QuotaMetricSummary;
  outboundMessages: QuotaMetricSummary;
  isBlocked: boolean;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  usage: UsageSummary;
}

export interface RegisterAiSessionResult {
  allowed: boolean;
  isNewSession: boolean;
  reason?: string;
  usage: UsageSummary;
}

export interface RecordAiUsageInput {
  tenantId: string;
  feature: AiUsageFeature;
  model: string;
  promptTokens: number;
  completionTokens: number;
  incrementSession?: boolean;
  incrementOutbound?: boolean;
  metadata?: Record<string, unknown> | null;
  now?: Date;
}
