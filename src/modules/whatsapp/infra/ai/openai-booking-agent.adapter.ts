import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiBookingTokenUsage,
  AiExecutedToolAction,
} from "../../application/ports/ai-booking-agent.port.js";
import {
  AI_BOOKING_TOOL_DEFINITIONS,
  bookingContingencyReply,
  buildAiBookingSystemPrompt,
  dispatchAiBookingToolCall,
  normalizeWhatsAppFormatting,
} from "./ai-booking-tool-definitions.js";

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

// Adaptador de agente de agendamento usando a API Chat Completions da OpenAI com Function Calling nativo via fetch.
export class OpenAiBookingAgentAdapter implements AiBookingAgentPort {
  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  ) {}

  async generateReply(
    input: AiBookingAgentInput,
  ): Promise<AiBookingAgentOutput> {
    const actions: AiExecutedToolAction[] = [];
    const usage: AiBookingTokenUsage = { model: this.model, promptTokens: 0, completionTokens: 0 };
    try {
      return await this.runTurn(input, actions, usage);
    } catch (error) {
      const handoff = actions.find((action) => action.tool === "request_human_handoff" && action.ok);
      const converted = actions.some((action) =>
        action.ok && (action.tool === "criar_agendamento" || action.tool === "reagendar_agendamento"),
      );
      const canceled = actions.some((action) => action.tool === "cancelar_agendamento" && action.ok);
      if (!converted && !canceled && !handoff) throw error;
      console.warn("[WhatsApp AI] Falha no OpenAI após executar ação:", error);
      return {
        replyText: bookingContingencyReply(actions),
        provider: "OPENAI",
        actions,
        usage,
        converted,
        ...(handoff ? { handoffRequested: handoff.data as { reason: string } } : {}),
      };
    }
  }

  private async runTurn(
    input: AiBookingAgentInput,
    actions: AiExecutedToolAction[],
    usage: AiBookingTokenUsage,
  ): Promise<AiBookingAgentOutput> {
    let converted = false;
    let handoffRequested: { reason: string } | undefined;

    const slidingHistory = input.history.slice(-10);

    const messages: OpenAiChatMessage[] = [
      { role: "system", content: buildAiBookingSystemPrompt(input) },
      ...slidingHistory.map<OpenAiChatMessage>((msg) => ({
        role: msg.direction === "INBOUND" ? "user" : "assistant",
        content: msg.content,
      })),
    ];

    const lastInHistory = slidingHistory[slidingHistory.length - 1];
    if (
      !lastInHistory ||
      lastInHistory.direction !== "INBOUND" ||
      lastInHistory.content.trim() !== input.latestClientMessage.trim()
    ) {
      messages.push({ role: "user", content: input.latestClientMessage });
    }

    const openAiTools = AI_BOOKING_TOOL_DEFINITIONS.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    for (let step = 0; step < 4; step++) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          messages,
          tools: openAiTools,
          tool_choice: "auto",
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API respondeu com status ${response.status}`);
      }

      const payload = (await response.json()) as {
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: OpenAiToolCall[];
          };
        }>;
      };

      usage.model = payload.model ?? usage.model;
      usage.promptTokens += payload.usage?.prompt_tokens ?? 0;
      usage.completionTokens += payload.usage?.completion_tokens ?? 0;
      const assistantMessage = payload.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const replyText = normalizeWhatsAppFormatting(
          assistantMessage?.content ?? "",
        ) || bookingContingencyReply(actions);
        return {
          replyText,
          provider: "OPENAI",
          actions,
          usage,
          converted,
          ...(handoffRequested ? { handoffRequested } : {}),
        };
      }

      messages.push({
        role: "assistant",
        content: assistantMessage?.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
        } catch {
          parsedArgs = {};
        }

        const dispatched = await dispatchAiBookingToolCall(
          call.function.name,
          parsedArgs,
          input.tools,
          actions,
        );
        if (dispatched.converted) converted = true;
        if (dispatched.handoffRequested) {
          handoffRequested = dispatched.handoffRequested;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(dispatched.result),
        });
      }
    }

    return {
      replyText:
        "Consegui verificar suas informações! Pode confirmar como prefere prosseguir com o agendamento?",
      provider: "OPENAI",
      actions,
      usage,
      converted,
      ...(handoffRequested ? { handoffRequested } : {}),
    };
  }
}
