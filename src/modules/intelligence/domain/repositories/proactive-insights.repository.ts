import type {
  AiProactiveInsightModule,
  AiProactiveInsightStatus,
} from "../../../billing/infra/database/schema/ai-proactive-insights-schema.js";
import type {
  CreateProactiveInsightRecordInput,
  ProactiveInsightRecord,
} from "../entities/proactive-insight.types.js";

export interface ListProactiveInsightsParams {
  tenantId: string;
  module?: AiProactiveInsightModule | undefined;
  status?: AiProactiveInsightStatus | undefined;
  limit?: number | undefined;
}

export interface ListProactiveInsightsResult {
  insights: ProactiveInsightRecord[];
  pendingCount: number;
}

// Contrato de persistência de insights proativos com isolamento obrigatório por tenantId.
export interface ProactiveInsightsRepository {
  listByTenant(
    params: ListProactiveInsightsParams,
  ): Promise<ListProactiveInsightsResult>;

  findByIdForTenant(
    tenantId: string,
    insightId: string,
  ): Promise<ProactiveInsightRecord | null>;

  existsPendingTodayByType(
    tenantId: string,
    type: string,
    now?: Date,
  ): Promise<boolean>;

  create(
    input: CreateProactiveInsightRecordInput,
  ): Promise<ProactiveInsightRecord>;

  updateStatusForTenant(
    tenantId: string,
    insightId: string,
    status: AiProactiveInsightStatus,
  ): Promise<ProactiveInsightRecord | null>;
}
