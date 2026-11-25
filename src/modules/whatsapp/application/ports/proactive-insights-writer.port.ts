import type { AiProactiveInsightModule } from "../../../billing/infra/database/schema/ai-proactive-insights-schema.js";

export interface CreateProactiveInsightInput {
  tenantId: string;
  module: AiProactiveInsightModule;
  type: string;
  title: string;
  description: string;
  impactLabel?: string | null | undefined;
  actionPayload?: Record<string, unknown> | null | undefined;
  expiresAt?: Date | null | undefined;
}

// Porta de escrita de alertas e insights proativos isolados por tenantId.
export interface ProactiveInsightsWriterPort {
  createInsight(input: CreateProactiveInsightInput): Promise<{ id: string }>;
}
