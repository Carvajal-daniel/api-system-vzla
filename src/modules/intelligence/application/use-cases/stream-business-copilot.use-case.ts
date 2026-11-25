import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type { BusinessMetricsProviderPort } from "../../../whatsapp/application/ports/business-metrics-provider.port.js";
import type { IntelligenceModule } from "../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../domain/repositories/intelligence-data.repository.js";
import type {
  CopilotHistoryItem,
  IntelligenceAiPort,
} from "../ports/intelligence-ai.port.js";

export interface StreamBusinessCopilotInput {
  tenantId: string;
  message: string;
  currentModule?: IntelligenceModule | undefined;
  history?: CopilotHistoryItem[] | undefined;
  now?: Date | undefined;
}

// Copiloto IA contextual com streaming SSE e injeção de KPIs multi-tenant do módulo atual.
export class StreamBusinessCopilotUseCase {
  constructor(
    private readonly businessMetricsProvider: BusinessMetricsProviderPort,
    private readonly dataRepository: IntelligenceDataRepository,
    private readonly aiPort: IntelligenceAiPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
  ) {}

  public async *execute(
    input: StreamBusinessCopilotInput,
  ): AsyncGenerator<string> {
    const now = input.now ?? new Date();
    const [globalMetrics, moduleMetrics] = await Promise.all([
      this.businessMetricsProvider.getSnapshot(input.tenantId, now),
      input.currentModule
        ? this.dataRepository.getModuleAggregatedMetrics(
            input.tenantId,
            input.currentModule,
            now,
          )
        : Promise.resolve(null),
    ]);

    let finalUsage = {
      model: "local-analytics",
      promptTokens: 0,
      completionTokens: 0,
    };

    for await (const event of this.aiPort.streamCopilot({
      message: input.message,
      currentModule: input.currentModule,
      history: input.history ?? [],
      globalMetrics,
      moduleMetrics,
    })) {
      if (event.type === "chunk") {
        yield event.text;
      } else if (event.type === "usage") {
        finalUsage = event.usage;
      }
    }

    await this.planQuotaGuard.recordAiUsage({
      tenantId: input.tenantId,
      feature: "COPILOT",
      model: finalUsage.model,
      promptTokens: finalUsage.promptTokens,
      completionTokens: finalUsage.completionTokens,
      incrementOutbound: false,
      metadata: {
        currentModule: input.currentModule ?? null,
      },
      now,
    });
  }
}
