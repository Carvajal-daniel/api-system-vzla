import type { BusinessMetricsSnapshot } from "./business-metrics-provider.port.js";

export interface CopilotHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BusinessCopilotInput {
  message: string;
  history: CopilotHistoryMessage[];
  metrics: BusinessMetricsSnapshot;
}

export interface BusinessCopilotOutput {
  reply: string;
  provider: "OPENAI" | "GEMINI" | "LOCAL_ANALYTICS";
  suggestedFollowups: string[];
}

export interface BusinessCopilotPort {
  answer(input: BusinessCopilotInput): Promise<BusinessCopilotOutput>;
}
