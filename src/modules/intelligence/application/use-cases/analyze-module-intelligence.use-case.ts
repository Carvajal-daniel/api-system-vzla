import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type { IntelligenceModule } from "../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../domain/repositories/intelligence-data.repository.js";
import type {
  IntelligenceAiPort,
  ModuleAnalysisResult,
} from "../ports/intelligence-ai.port.js";

// Análise instantânea sob demanda por módulo usando agregação SQL enxuta + Gemini flash-lite.
export class AnalyzeModuleIntelligenceUseCase {
  constructor(
    private readonly dataRepository: IntelligenceDataRepository,
    private readonly aiPort: IntelligenceAiPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
  ) {}

  public async execute(
    tenantId: string,
    module: IntelligenceModule,
    now: Date = new Date(),
  ): Promise<ModuleAnalysisResult> {
    const payload = await this.dataRepository.getModuleAggregatedMetrics(
      tenantId,
      module,
      now,
    );

    const { analysis, usage } = await this.aiPort.analyzeModule(payload);

    await this.planQuotaGuard.recordAiUsage({
      tenantId,
      feature: "MODULE_ANALYSIS",
      model: usage.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      incrementOutbound: false,
      metadata: { module },
      now,
    });

    return analysis;
  }
}
