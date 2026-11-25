import type {
  SendMessageResult,
  WhatsAppGatewayPort,
  WhatsAppSendPurpose,
} from "../ports/whatsapp-gateway.port.js";

export const DEFAULT_INBOUND_DEBOUNCE_MS = 4_000;
export const DEFAULT_TYPING_DELAY_MS = 5_000;

function resolveEnvMs(envKey: string, fallbackMs: number): number {
  const raw = process.env[envKey]?.trim();
  if (!raw) return fallbackMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallbackMs;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface DebouncedTurnPayload {
  tenantId: string;
  conversationId: string;
  message: string;
  debounceMs?: number | undefined;
  onFlush: (mergedMessage: string) => Promise<void>;
}

interface PendingTurnEntry {
  timer: ReturnType<typeof setTimeout>;
  messages: string[];
  onFlush: (mergedMessage: string) => Promise<void>;
}

export interface SendHumanizedReplyInput {
  tenantId: string;
  to: string;
  text: string;
  purpose?: WhatsAppSendPurpose | undefined;
  typingDelayMs?: number | undefined;
}

// Orquestrador de turno conversacional no WhatsApp:
// 1) Agrupa mensagens picadas em janela de debounce (4s) isolada por (tenantId, conversationId).
// 2) Humaniza a saída enviando presença "composing", aguardando 5s e enviando o texto seguido de "paused".
export class WhatsAppAiTurnOrchestrator {
  private readonly pendingTurns = new Map<string, PendingTurnEntry>();
  private readonly defaultDebounceMs: number;
  private readonly defaultTypingDelayMs: number;

  constructor(
    private readonly whatsappGateway: WhatsAppGatewayPort,
    options?: {
      defaultDebounceMs?: number | undefined;
      defaultTypingDelayMs?: number | undefined;
    },
  ) {
    this.defaultDebounceMs =
      options?.defaultDebounceMs ??
      resolveEnvMs("WHATSAPP_AI_DEBOUNCE_MS", DEFAULT_INBOUND_DEBOUNCE_MS);
    this.defaultTypingDelayMs =
      options?.defaultTypingDelayMs ??
      resolveEnvMs("WHATSAPP_AI_TYPING_DELAY_MS", DEFAULT_TYPING_DELAY_MS);
  }

  private buildKey(tenantId: string, conversationId: string): string {
    return `${tenantId}:${conversationId}`;
  }

  public getDefaultDebounceMs(): number {
    return this.defaultDebounceMs;
  }

  public getDefaultTypingDelayMs(): number {
    return this.defaultTypingDelayMs;
  }

  public scheduleTurn(input: DebouncedTurnPayload): void {
    const key = this.buildKey(input.tenantId, input.conversationId);
    const existing = this.pendingTurns.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const messages = existing
      ? [...existing.messages, input.message]
      : [input.message];

    const delayMs = input.debounceMs ?? this.defaultDebounceMs;

    const timer = setTimeout(() => {
      const entry = this.pendingTurns.get(key);
      this.pendingTurns.delete(key);
      if (!entry) return;

      const merged = entry.messages.join("\n");
      void entry.onFlush(merged).catch(() => undefined);
    }, delayMs);

    this.pendingTurns.set(key, {
      timer,
      messages,
      onFlush: input.onFlush,
    });
  }

  public cancelTurn(tenantId: string, conversationId: string): void {
    const key = this.buildKey(tenantId, conversationId);
    const existing = this.pendingTurns.get(key);
    if (existing) {
      clearTimeout(existing.timer);
      this.pendingTurns.delete(key);
    }
  }

  public dispose(): void {
    for (const entry of this.pendingTurns.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingTurns.clear();
  }

  public async sendHumanizedReply(
    input: SendHumanizedReplyInput,
  ): Promise<SendMessageResult> {
    const typingDelayMs = input.typingDelayMs ?? this.defaultTypingDelayMs;
    const purpose: WhatsAppSendPurpose = input.purpose ?? "RECEPTION";

    try {
      await this.whatsappGateway.sendPresence({
        tenantId: input.tenantId,
        to: input.to,
        presence: "composing",
      });
    } catch {
      // Presença "digitando..." é melhor esforço e não deve bloquear o envio da resposta.
    }

    await sleep(typingDelayMs);

    const result = await this.whatsappGateway.sendText({
      tenantId: input.tenantId,
      to: input.to,
      text: input.text,
      purpose,
    });

    try {
      await this.whatsappGateway.sendPresence({
        tenantId: input.tenantId,
        to: input.to,
        presence: "paused",
      });
    } catch {
      // Ignora erro de presença final após mensagem já entregue.
    }

    return result;
  }

  public async sendImmediateText(input: {
    tenantId: string;
    to: string;
    text: string;
    purpose?: WhatsAppSendPurpose | undefined;
  }): Promise<SendMessageResult> {
    return this.whatsappGateway.sendText({
      tenantId: input.tenantId,
      to: input.to,
      text: input.text,
      purpose: input.purpose ?? "RECEPTION",
    });
  }
}
