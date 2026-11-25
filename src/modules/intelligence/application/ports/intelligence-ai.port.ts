import type { AiProactiveInsightModule } from "../../../billing/infra/database/schema/ai-proactive-insights-schema.js";
import type { BusinessMetricsSnapshot } from "../../../whatsapp/application/ports/business-metrics-provider.port.js";
import type {
  InactiveClientCandidate,
  IntelligenceModule,
  ModuleMetricsPayload,
  ProactiveScanMetrics,
  RetentionTrack,
} from "../../domain/entities/proactive-insight.types.js";

export interface AiUsageTokens {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface RetentionMessagePromptInput {
  companyName: string;
  track: RetentionTrack;
  client: InactiveClientCandidate;
}

export interface AiTextGenerationResult {
  text: string;
  usage: AiUsageTokens;
}

export interface ProactiveInsightCandidate {
  module: AiProactiveInsightModule;
  type: string;
  title: string;
  description: string;
  impactLabel: string | null;
  actionPayload: Record<string, unknown> | null;
}

export interface ProactiveInsightsAiResult {
  insights: ProactiveInsightCandidate[];
  usage: AiUsageTokens;
}

export interface ModuleAnalysisInsightItem {
  title: string;
  detail: string;
  severity: "INFO" | "OPPORTUNITY" | "WARNING";
}

export interface ModuleAnalysisResult {
  module: IntelligenceModule;
  headline: string;
  insights: ModuleAnalysisInsightItem[];
  recommendedAction: string;
  provider: "GEMINI" | "LOCAL_ANALYTICS";
}

export interface ModuleAnalysisAiResult {
  analysis: ModuleAnalysisResult;
  usage: AiUsageTokens;
}

export interface CopilotHistoryItem {
  role: "user" | "assistant";
  content: string;
}

export interface CopilotStreamAiInput {
  message: string;
  currentModule?: IntelligenceModule | undefined;
  history: CopilotHistoryItem[];
  globalMetrics: BusinessMetricsSnapshot;
  moduleMetrics?: ModuleMetricsPayload | null | undefined;
}

export type CopilotStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "usage"; usage: AiUsageTokens };

// Porta de IA para a Etapa 3: retencao em 3 trilhas, motor proativo, analise instantanea e copiloto SSE.
export interface IntelligenceAiPort {
  generateRetentionMessage(
    input: RetentionMessagePromptInput,
  ): Promise<AiTextGenerationResult>;

  generateProactiveInsights(
    metrics: ProactiveScanMetrics,
  ): Promise<ProactiveInsightsAiResult>;

  analyzeModule(payload: ModuleMetricsPayload): Promise<ModuleAnalysisAiResult>;

  streamCopilot(input: CopilotStreamAiInput): AsyncGenerator<CopilotStreamEvent>;
}
