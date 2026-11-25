import type {
  SendMessageResult,
  WhatsAppGatewayPort,
  WhatsAppSendPurpose,
} from "../ports/whatsapp-gateway.port.js";

export const DEFAULT_INBOUND_DEBOUNCE_MS = 1_500;
export const DEFAULT_TYPING_DELAY_MS = 1_200;
export const DEFAULT_COMPOSING_HEARTBEAT_MS = 3_500;

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
  // Permite pular o "composing" inicial quando já foi disparado antes da chamada ao agente de IA.
  skipInitialComposing?: boolean | undefined;
}

export interface TurnOrchestratorLogger {
  error(obj: Record<string, unknown>, msg?: string): void;
}

// Orquestrador de turno conversacional no WhatsApp:
// 1) Agrupa mensagens picadas em janela de debounce (1,5s padrão) isolada por (tenantId, conversationId).
// 2) Humaniza a saída enviando presença "composing", aguardando o delay configurado (1,2s padrão) e enviando o texto seguido de "paused".
export class WhatsAppAiTurnOrchestrator {
  private readonly pendingTurns = new Map<string, PendingTurnEntry>();
  private readonly turnTails = new Map<string, Promise<void>>();
  private readonly activeHeartbeats = new Set<ReturnType<typeof setInterval>>();
  private readonly defaultDebounceMs: number;
  private readonly defaultTypingDelayMs: number;
  private readonly logger?: TurnOrchestratorLogger | undefined;

  constructor(
    private readonly whatsappGateway: WhatsAppGatewayPort,
    options?: {
      defaultDebounceMs?: number | undefined;
      defaultTypingDelayMs?: number | undefined;
      logger?: TurnOrchestratorLogger | undefined;
    },
  ) {
    this.defaultDebounceMs =
      options?.defaultDebounceMs ??
      resolveEnvMs("WHATSAPP_AI_DEBOUNCE_MS", DEFAULT_INBOUND_DEBOUNCE_MS);
    this.defaultTypingDelayMs =
      options?.defaultTypingDelayMs ??
      resolveEnvMs("WHATSAPP_AI_TYPING_DELAY_MS", DEFAULT_TYPING_DELAY_MS);
    this.logger = options?.logger;
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

  public runSerially<T>(
    tenantId: string,
    conversationId: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const key = this.buildKey(tenantId, conversationId);
    const result = (this.turnTails.get(key) ?? Promise.resolve()).then(run);
    const tail = result.then(() => undefined, () => undefined);
    this.turnTails.set(key, tail);
    void tail.then(() => {
      if (this.turnTails.get(key) === tail) this.turnTails.delete(key);
    });
    return result;
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
      void this.runSerially(input.tenantId, input.conversationId, () =>
        entry.onFlush(merged),
      ).catch((error: unknown) => {
        if (this.logger) {
          this.logger.error(
            {
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              err: error,
            },
            "Failed to flush debounced WhatsApp AI turn",
          );
        } else {
          console.error(
            "[WhatsAppAiTurnOrchestrator] Failed to flush debounced AI turn:",
            {
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              error,
            },
          );
        }
      });
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
    for (const timer of this.activeHeartbeats) {
      clearInterval(timer);
    }
    this.activeHeartbeats.clear();
  }

  // Dispara presença "composing" ("digitando...") de forma best-effort antes da inferência da IA,
  // permitindo que o cliente veja atividade imediatamente enquanto a agenda é consultada.
  public async sendTypingPresence(input: {
    tenantId: string;
    to: string;
  }): Promise<void> {
    try {
      await this.whatsappGateway.sendPresence({
        tenantId: input.tenantId,
        to: input.to,
        presence: "composing",
      });
    } catch {
      // Presença "digitando..." é melhor esforço e não deve bloquear o turno de resposta.
    }
  }

  // Mantém os 3 pontinhos ("digitando...") ativos no WhatsApp durante toda a inferência da IA:
  // dispara "composing" imediatamente e renova a cada 3500ms até que a função de parada seja chamada.
  public startComposingHeartbeat(input: {
    tenantId: string;
    to: string;
    intervalMs?: number | undefined;
  }): () => void {
    const intervalMs = input.intervalMs ?? DEFAULT_COMPOSING_HEARTBEAT_MS;
    const emit = () => {
      void this.sendTypingPresence({
        tenantId: input.tenantId,
        to: input.to,
      });
    };

    emit();

    const timer = setInterval(emit, intervalMs);
    this.activeHeartbeats.add(timer);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      this.activeHeartbeats.delete(timer);
    };
  }

  public async sendHumanizedReply(
    input: SendHumanizedReplyInput,
  ): Promise<SendMessageResult> {
    const typingDelayMs = input.typingDelayMs ?? this.defaultTypingDelayMs;
    const purpose: WhatsAppSendPurpose = input.purpose ?? "RECEPTION";

    if (!input.skipInitialComposing) {
      await this.sendTypingPresence({
        tenantId: input.tenantId,
        to: input.to,
      });
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
