import type {
  DailyBriefingSnapshot,
  InactiveClientCandidate,
  IntelligenceModule,
  ModuleMetricsPayload,
  ProactiveScanMetrics,
} from "../entities/proactive-insight.types.js";

// Contrato de leitura agregada multi-tenant para retencao, motor proativo, analise por modulo e briefing.
export interface IntelligenceDataRepository {
  listActiveTenantIds(): Promise<string[]>;

  findInactiveClientsForRetention(
    tenantId: string,
    now?: Date,
  ): Promise<InactiveClientCandidate[]>;

  getProactiveScanMetrics(
    tenantId: string,
    now?: Date,
  ): Promise<ProactiveScanMetrics>;

  getModuleAggregatedMetrics(
    tenantId: string,
    module: IntelligenceModule,
    now?: Date,
  ): Promise<ModuleMetricsPayload>;

  getDailyBriefingSnapshot(
    tenantId: string,
    now?: Date,
  ): Promise<DailyBriefingSnapshot | null>;
}
