import type {
  AiUsageFeature,
  PlanTier,
  TenantUsageMetricsRecord,
} from "../entities/tenant-usage.types.js";

export interface IncrementUsageAndLogParams {
  tenantId: string;
  periodMonth: string;
  feature: AiUsageFeature;
  model: string;
  promptTokens: number;
  completionTokens: number;
  aiSessionsDelta: number;
  outboundMessagesDelta: number;
  metadata: Record<string, unknown> | null;
  now: Date;
}

// Porta de persistência da governança de cotas; todas as operações exigem tenantId explicitamente.
export interface TenantUsageRepository {
  getTenantPlanTier(tenantId: string): Promise<PlanTier>;

  getMonthlyUsage(
    tenantId: string,
    periodMonth: string,
  ): Promise<TenantUsageMetricsRecord | null>;

  incrementUsageAndLog(
    params: IncrementUsageAndLogParams,
  ): Promise<TenantUsageMetricsRecord>;

  incrementAiSessionCount(
    tenantId: string,
    periodMonth: string,
    now: Date,
  ): Promise<TenantUsageMetricsRecord>;

  getConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
  ): Promise<Date | null>;

  updateConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
    lastAiSessionAt: Date,
  ): Promise<boolean>;
}
