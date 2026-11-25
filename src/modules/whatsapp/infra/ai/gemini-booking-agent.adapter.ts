import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";
import {
  AI_BOOKING_TOOL_DEFINITIONS,
  buildAiBookingSystemPrompt,
  dispatchAiBookingToolCall,
} from "./ai-booking-tool-definitions.js";
import { fetchGeminiGenerateContentWithFallback } from "./gemini-request-with-fallback.js";

interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// Adaptador de agente de agendamento usando a API REST do Google Gemini com Function Calling nativo via fetch.
export class GeminiBookingAgentAdapter implements AiBookingAgentPort {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite",
    private readonly fallbackModel = process.env.GEMINI_FALLBACK_MODEL?.trim() ||
      "gemini-3.5-flash",
  ) {}

  async generateReply(
    input: AiBookingAgentInput,
  ): Promise<AiBookingAgentOutput> {
    const actions: AiExecutedToolAction[] = [];
    let converted = false;

    const contents: GeminiContent[] = input.history.map((msg) => ({
      role: msg.direction === "INBOUND" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const lastInHistory = input.history[input.history.length - 1];
    if (
      !lastInHistory ||
      lastInHistory.direction !== "INBOUND" ||
      lastInHistory.content.trim() !== input.latestClientMessage.trim()
    ) {
      contents.push({
        role: "user",
        parts: [{ text: input.latestClientMessage }],
      });
    }

    // A API REST do Gemini rejeita declarações OBJECT com `properties: {}` (HTTP 400);
    // portanto omitimos `parameters` em ferramentas sem argumentos como `listar_servicos_e_profissionais`.
    const functionDeclarations = AI_BOOKING_TOOL_DEFINITIONS.map((tool) => {
      const hasProperties = Object.keys(tool.parameters.properties).length > 0;
      return {
        name: tool.name,
        description: tool.description,
        ...(hasProperties ? { parameters: tool.parameters } : {}),
      };
    });

    try {
      // Permite até 5 turnos de tool-calling (ex.: listar catálogo -> consultar horários -> criar agendamento -> resposta/recuperação de conflito).
      for (let step = 0; step < 5; step++) {
        const { response, usedModel } =
          await fetchGeminiGenerateContentWithFallback({
            apiKey: this.apiKey,
            primaryModel: this.model,
            fallbackModel: this.fallbackModel,
            timeoutMs: 20_000,
            body: {
              systemInstruction: {
                parts: [{ text: buildAiBookingSystemPrompt(input) }],
              },
              contents,
              tools: [{ functionDeclarations }],
              // Usa thinkingLevel "minimal" no Gemini 3.5 para desativar raciocínio interno excessivo e manter baixa latência (~1-2s) no chat.
              generationConfig: {
                thinkingConfig: { thinkingLevel: "minimal" },
                temperature: 0.4,
              },
            },
          });

        if (!response.ok) {
          const errorBody = (await response.text().catch(() => "")).slice(0, 400);
          throw new Error(
            `Gemini API (${usedModel}) respondeu com status ${response.status}${errorBody ? `: ${errorBody}` : ""}`,
          );
        }

        const payload = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: GeminiPart[];
            };
          }>;
        };

        const parts = payload.candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts
          .map((part) => part.functionCall)
          .filter((fc): fc is NonNullable<GeminiPart["functionCall"]> => Boolean(fc));

        if (functionCalls.length === 0) {
          const replyText =
            parts
              .map((part) => part.text ?? "")
              .join("")
              .trim() || "Olá! Como posso ajudar com seu agendamento hoje?";
          return {
            replyText,
            provider: "GEMINI",
            actions,
            converted,
          };
        }

        contents.push({ role: "model", parts });

        const responseParts: GeminiPart[] = [];
        for (const call of functionCalls) {
          const dispatched = await dispatchAiBookingToolCall(
            call.name,
            call.args ?? {},
            input.tools,
            actions,
          );
          if (dispatched.converted) converted = true;

          responseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: dispatched.result },
            },
          });
        }

        contents.push({ role: "user", parts: responseParts });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn("[WhatsApp AI] Fallback para SIMULATED:", reason);
      throw error;
    }

    return {
      replyText:
        "Consegui verificar suas informações! Pode confirmar como prefere prosseguir com o agendamento?",
      provider: "GEMINI",
      actions,
      converted,
    };
  }
}
