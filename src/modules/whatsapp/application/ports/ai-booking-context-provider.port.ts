import type {
  AiBookingCompanyContext,
  AiBookingToolExecutor,
} from "./ai-booking-agent.port.js";

// Porta para fornecer contexto da empresa e executor de ferramentas reais de agenda para a IA.
export interface AiBookingContextProviderPort {
  buildContextAndTools(input: {
    companyId: string;
    aiSystemPrompt: string | null;
    clientName: string;
    clientPhone: string;
  }): Promise<{
    company: AiBookingCompanyContext;
    tools: AiBookingToolExecutor;
  } | null>;
}
