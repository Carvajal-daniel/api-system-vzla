import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";
import {
  AI_BOOKING_TOOL_DEFINITIONS,
  bookingContingencyReply,
  buildAiBookingSystemPrompt,
  dispatchAiBookingToolCall,
  normalizeWhatsAppFormatting,
} from "./ai-booking-tool-definitions.js";
import { fetchGeminiGenerateContentWithFallback } from "./gemini-request-with-fallback.js";

interface GeminiPart {
  text?: string;
  thought?: boolean;
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

// Seleciona a configuração de thinking de menor latência conforme a geração do modelo Gemini:
// - Família Gemini 2.5 usa `thinkingBudget: 0` para eliminar latência extra de raciocínio.
// - Família Gemini 3+ (ex.: gemini-3.5-flash-lite / gemini-3.5-flash) usa `thinkingLevel: "minimal"`.
export function resolveGeminiThinkingConfig(
  model: string,
): { thinkingBudget: number } | { thinkingLevel: "minimal" } {
  const normalized = model.trim().toLowerCase();
  if (normalized.startsWith("gemini-2.5")) {
    return { thinkingBudget: 0 };
  }
  return { thinkingLevel: "minimal" };
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
    let handoffRequested: { reason: string } | undefined;
    let promptTokens = 0;
    let completionTokens = 0;
    let lastUsedModel = this.model;

    // Janela deslizante: envia somente as últimas 10 mensagens do histórico para controlar consumo de tokens.
    const slidingHistory = input.history.slice(-10);

    const contents: GeminiContent[] = slidingHistory.map((msg) => ({
      role: msg.direction === "INBOUND" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    const lastInHistory = slidingHistory[slidingHistory.length - 1];
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
            body: (model) => ({
              systemInstruction: {
                parts: [{ text: buildAiBookingSystemPrompt(input) }],
              },
              contents,
              tools: [{ functionDeclarations }],
              // Usa raciocínio mínimo conforme a geração do modelo e maxOutputTokens: 500 para suportar
              // listagem de catálogo por categorias e planos de assinatura sem truncar a resposta.
              generationConfig: {
                thinkingConfig: resolveGeminiThinkingConfig(model),
                temperature: 0.4,
                maxOutputTokens: 500,
              },
            }),
          });

        lastUsedModel = usedModel;

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
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
        };

        promptTokens += payload.usageMetadata?.promptTokenCount ?? 0;
        completionTokens += payload.usageMetadata?.candidatesTokenCount ?? 0;

        const parts = payload.candidates?.[0]?.content?.parts ?? [];
        const functionCalls = parts
          .map((part) => part.functionCall)
          .filter((fc): fc is NonNullable<GeminiPart["functionCall"]> => Boolean(fc));

        if (functionCalls.length === 0) {
          const replyText = normalizeWhatsAppFormatting(
            parts.filter((part) => !part.thought).map((part) => part.text ?? "").join(""),
          ) || bookingContingencyReply(actions);
          return {
            replyText,
            provider: "GEMINI",
            actions,
            converted,
            ...(handoffRequested ? { handoffRequested } : {}),
            usage: {
              model: lastUsedModel,
              promptTokens,
              completionTokens,
            },
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
          if (dispatched.handoffRequested) {
            handoffRequested = dispatched.handoffRequested;
          }

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
      console.warn("[WhatsApp AI] Falha no Gemini:", reason);
    }

    return {
      replyText: bookingContingencyReply(actions),
      provider: "GEMINI",
      actions,
      converted,
      ...(handoffRequested ? { handoffRequested } : {}),
      usage: {
        model: lastUsedModel,
        promptTokens,
        completionTokens,
      },
    };
  }
}
