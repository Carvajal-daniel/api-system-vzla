import { getAiEnv } from "../../../../shared/config/env.js";
import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
} from "../../application/ports/ai-booking-agent.port.js";
import { GeminiBookingAgentAdapter } from "./gemini-booking-agent.adapter.js";
import { OpenAiBookingAgentAdapter } from "./openai-booking-agent.adapter.js";
import { bookingContingencyReply } from "./ai-booking-tool-definitions.js";

export class ResilientAiBookingAgentAdapter implements AiBookingAgentPort {
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

    for (const candidate of candidates) {
      try {
        return await candidate.adapter.generateReply(input);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(
          "[WhatsApp AI] Falha no provedor de agendamento:",
          `Provedor ${candidate.name} falhou (${reason})`,
        );
      }
    }

    if (!candidates.length) {
      console.warn("[WhatsApp AI] Nenhum provedor de agendamento configurado.");
    }

    return {
      replyText: bookingContingencyReply([]),
      provider: candidates.at(-1)?.name ?? "UNAVAILABLE",
      actions: [],
      converted: false,
    };
  }
}

export function createAiBookingAgentAdapter(): AiBookingAgentPort {
  return new ResilientAiBookingAgentAdapter();
}
