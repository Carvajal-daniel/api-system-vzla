import { getAiEnv } from "../../../../shared/config/env.js";
import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
} from "../../application/ports/ai-booking-agent.port.js";
import { GeminiBookingAgentAdapter } from "./gemini-booking-agent.adapter.js";
import { OpenAiBookingAgentAdapter } from "./openai-booking-agent.adapter.js";
import { SimulatedBookingAgentAdapter } from "./simulated-booking-agent.adapter.js";

// Adaptador resiliente: seleciona OpenAI e/ou Gemini via env validado e cai para o SimulatedBookingAgentAdapter
// caso nenhuma chave esteja configurada ou ocorra falha transitória de rede na API externa.
export class ResilientAiBookingAgentAdapter implements AiBookingAgentPort {
  private readonly fallback = new SimulatedBookingAgentAdapter();

  async generateReply(
    input: AiBookingAgentInput,
  ): Promise<AiBookingAgentOutput> {
    const aiEnv = getAiEnv();
    const candidates: Array<{ name: "OPENAI" | "GEMINI"; adapter: AiBookingAgentPort }> = [];

    if (aiEnv.openAiApiKey) {
      candidates.push({
        name: "OPENAI",
        adapter: new OpenAiBookingAgentAdapter(
          aiEnv.openAiApiKey,
          aiEnv.openAiModel,
        ),
      });
    }
    if (aiEnv.geminiApiKey) {
      candidates.push({
        name: "GEMINI",
        adapter: new GeminiBookingAgentAdapter(
          aiEnv.geminiApiKey,
          aiEnv.geminiModel,
          aiEnv.geminiFallbackModel,
        ),
      });
    }

    if (candidates.length === 0) {
      console.warn(
        "[WhatsApp AI] Fallback para SIMULATED:",
        "Nenhuma chave OPENAI_API_KEY ou GEMINI_API_KEY encontrada em process.env.",
      );
      return this.fallback.generateReply(input);
    }

    for (const candidate of candidates) {
      try {
        return await candidate.adapter.generateReply(input);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          "[WhatsApp AI] Fallback para SIMULATED:",
          `Provedor ${candidate.name} falhou (${reason})`,
        );
      }
    }

    return this.fallback.generateReply(input);
  }
}

export function createAiBookingAgentAdapter(): AiBookingAgentPort {
  return new ResilientAiBookingAgentAdapter();
}
