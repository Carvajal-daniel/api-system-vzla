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
    let converted = false;

    const messages: OpenAiChatMessage[] = [
      { role: "system", content: buildAiBookingSystemPrompt(input) },
      ...input.history.map<OpenAiChatMessage>((msg) => ({
        role: msg.direction === "INBOUND" ? "user" : "assistant",
        content: msg.content,
      })),
    ];

    const lastInHistory = input.history[input.history.length - 1];
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
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: OpenAiToolCall[];
          };
        }>;
      };

      const assistantMessage = payload.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        const replyText =
          assistantMessage?.content?.trim() ||
          "Olá! Como posso ajudar com seu agendamento hoje?";
        return {
          replyText,
          provider: "OPENAI",
          actions,
          converted,
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
      converted,
    };
  }
}
