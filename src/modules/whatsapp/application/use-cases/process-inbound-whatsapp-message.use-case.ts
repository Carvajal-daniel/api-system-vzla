import { Client } from "../../../clients/domain/entities/client.entity.js";
import type { ClientsRepository } from "../../../clients/domain/repositories/clients.repository.js";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type {
  WhatsAppConversation,
  WhatsAppConversationDTO,
} from "../../domain/entities/whatsapp-conversation.entity.js";
import {
  WhatsAppMessage,
  type WhatsAppMessageDTO,
} from "../../domain/entities/whatsapp-message.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type {
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiExecutedToolAction,
} from "../ports/ai-booking-agent.port.js";
import type { AiBookingContextProviderPort } from "../ports/ai-booking-context-provider.port.js";
import {
  resolveCustomerDisplayName,
  sanitizeCustomerName,
} from "../../infra/ai/ai-booking-tool-definitions.js";
import type { ProactiveInsightsWriterPort } from "../ports/proactive-insights-writer.port.js";
import type { WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.js";
import {
  DEFAULT_INBOUND_DEBOUNCE_MS,
  WhatsAppAiTurnOrchestrator,
} from "../services/whatsapp-ai-turn-orchestrator.js";
import type { AnalyzeWhatsAppConversationUseCase } from "./analyze-whatsapp-conversation.use-case.js";

export const ANTI_SPAM_HOURLY_LIMIT = 15;
export const ANTI_SPAM_WINDOW_MS = 60 * 60 * 1000;
export const AI_AUTO_PAUSE_MS = 2 * 60 * 60 * 1000;
export const ANTI_SPAM_FIXED_REPLY =
  "Para outros assuntos ou atendimento específico, aguarde que um de nossos atendentes responderá em breve.";

export interface ConversationalDispatchPort {
  send(input: {
    purpose: "CONVERSATIONAL_REPLY";
    companyId: string;
    phone: string;
    text: string;
  }): Promise<{
    purpose: "CONVERSATIONAL_REPLY" | "CAMPAIGN_BLAST";
    provider: "EVOLUTION" | "MOCK_READY" | "DATAFY";
    referenceId: string;
  }>;
}

export interface InboundNpsReplyHandlerPort {
  tryHandleInboundReply(input: {
    companyId: string;
    conversation: WhatsAppConversation;
    phone: string;
    content: string;
    now: Date;
  }): Promise<{
    handled: boolean;
    conversation?: WhatsAppConversation;
    outboundMessage?: WhatsAppMessage | null;
  }>;
}

export interface ProcessInboundWhatsAppMessageInput {
  companyId: string;
  phone: string;
  contactName?: string | null | undefined;
  content: string;
  externalMessageId?: string | null | undefined;
  providerMessageId?: string | null | undefined;
  sentAt?: Date | undefined;
  source?: "WEBHOOK" | "SIMULATOR" | undefined;
  // Janela de debounce em ms (1500ms padrão no webhook para agrupar mensagens seguidas; 0ms no simulador/testes).
  debounceMs?: number | undefined;
  // Delay humanizado "Digitando..." em ms (1200ms padrão no webhook; 0ms no simulador/testes).
  typingDelayMs?: number | undefined;
}

export interface ProcessInboundWhatsAppMessageOutput {
  duplicated: boolean;
  conversation: WhatsAppConversationDTO;
  inboundMessage: WhatsAppMessageDTO;
  outboundMessage: WhatsAppMessageDTO | null;
  aiScheduled: boolean;
  aiActions: AiExecutedToolAction[];
  blockedReason?: "AI_PAUSED" | "ANTI_SPAM" | "QUOTA_EXCEEDED" | "NPS_HANDLED" | undefined;
}

export interface ProcessInboundWhatsAppMessageOptions {
  planQuotaGuard?: PlanQuotaGuardUseCase | undefined;
  whatsappGateway?: WhatsAppGatewayPort | undefined;
  turnOrchestrator?: WhatsAppAiTurnOrchestrator | undefined;
  proactiveInsightsWriter?: ProactiveInsightsWriterPort | undefined;
  npsReplyHandler?: InboundNpsReplyHandlerPort | undefined;
}

// Adapta o router legado para a porta hexagonal WhatsAppGatewayPort quando testes antigos não injetam o gateway novo.
function wrapLegacyDispatchAsGateway(
  legacyRouter: ConversationalDispatchPort,
): WhatsAppGatewayPort {
  return {
    sendText: async (params) => {
      const dispatched = await legacyRouter.send({
        purpose: "CONVERSATIONAL_REPLY",
        companyId: params.tenantId,
        phone: params.to,
        text: params.text,
      });
      return { externalMessageId: dispatched.referenceId };
    },
    sendTemplate: async () => ({}),
    sendPresence: async () => undefined,
    getChannelsStatus: async () => [],
  };
}

// Caso de uso central do atendimento WhatsApp: garante idempotência, isolamento multi-tenant,
// filtro NPS, pausa/anti-spam, governança de cotas, debounce (4s) e resposta humanizada (Digitando + 5s).
export class ProcessInboundWhatsAppMessageUseCase {
  private readonly turnOrchestrator: WhatsAppAiTurnOrchestrator;
  private readonly inboundInFlight = new Map<string, Promise<ProcessInboundWhatsAppMessageOutput>>();
  private readonly planQuotaGuard?: PlanQuotaGuardUseCase | undefined;
  private readonly proactiveInsightsWriter?: ProactiveInsightsWriterPort | undefined;
  private readonly npsReplyHandler?: InboundNpsReplyHandlerPort | undefined;

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly connectionsRepository: CompanyWhatsAppConnectionRepository,
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly aiAgent: AiBookingAgentPort,
    private readonly aiContextProvider: AiBookingContextProviderPort,
    gatewayRouter: ConversationalDispatchPort,
    private readonly analyzeConversationUseCase?: AnalyzeWhatsAppConversationUseCase,
    options?: ProcessInboundWhatsAppMessageOptions,
  ) {
    this.planQuotaGuard = options?.planQuotaGuard;
    this.proactiveInsightsWriter = options?.proactiveInsightsWriter;
    this.npsReplyHandler = options?.npsReplyHandler;

    if (options?.turnOrchestrator) {
      this.turnOrchestrator = options.turnOrchestrator;
    } else {
      const gateway =
        options?.whatsappGateway ?? wrapLegacyDispatchAsGateway(gatewayRouter);
      this.turnOrchestrator = new WhatsAppAiTurnOrchestrator(gateway, {
        // Quando testes antigos usam apenas o router legado sem options, evita delay de 5s em testes legados.
        defaultTypingDelayMs: options?.whatsappGateway ? undefined : 0,
      });
    }
  }

  public getTurnOrchestrator(): WhatsAppAiTurnOrchestrator {
    return this.turnOrchestrator;
  }

  async execute(
    input: ProcessInboundWhatsAppMessageInput,
  ): Promise<ProcessInboundWhatsAppMessageOutput> {
    const messageId = input.externalMessageId?.trim() || input.providerMessageId?.trim();
    if (!messageId) return this.processInbound(input);

    const key = `${input.companyId}:${messageId}`;
    const inFlight = this.inboundInFlight.get(key);
    if (inFlight) {
      const original = await inFlight;
      return {
        duplicated: true,
        conversation: original.conversation,
        inboundMessage: original.inboundMessage,
        outboundMessage: null,
        aiScheduled: false,
        aiActions: [],
      };
    }

    const processing = this.processInbound({ ...input, externalMessageId: messageId });
    this.inboundInFlight.set(key, processing);
    try {
      return await processing;
    } finally {
      this.inboundInFlight.delete(key);
    }
  }

  private async processInbound(
    input: ProcessInboundWhatsAppMessageInput,
  ): Promise<ProcessInboundWhatsAppMessageOutput> {
    // O índice único do banco também protege entregas em outros processos ou após reinício.
    if (input.externalMessageId) {
      const existingMessage =
        await this.messagesRepository.findByExternalMessageId(
          input.companyId,
          input.externalMessageId.trim(),
        );
      if (existingMessage) {
        const existingConversation =
          await this.conversationsRepository.findById(
            input.companyId,
            existingMessage.conversationId,
          );
        if (existingConversation) {
          return {
            duplicated: true,
            conversation: existingConversation.toDTO(existingMessage.content),
            inboundMessage: existingMessage.toDTO(),
            outboundMessage: null,
            aiScheduled: false,
            aiActions: [],
          };
        }
      }
    }

    const normalizedPhone = Phone.create(input.phone).value;
    const trimmedContent = input.content.trim();
    const sentAt = input.sentAt ?? new Date();
    const cleanContactName = input.contactName?.trim() || null;

    // 2. Resolve ou cria o cliente normalizado em `clients` por (companyId, phone)
    const sanitizedPushName = sanitizeCustomerName(cleanContactName);
    let client = await this.clientsRepository.findByPhone(
      input.companyId,
      normalizedPhone,
    );
    if (!client) {
      const fallbackName =
        sanitizedPushName ?? `Cliente ${normalizedPhone.slice(-4)}`;
      try {
        client = await this.clientsRepository.create(
          Client.create({
            companyId: input.companyId,
            name: fallbackName,
            phone: normalizedPhone,
            tags: ["whatsapp"],
          }),
        );
      } catch {
        // Proteção contra corrida concorrente de criação do mesmo telefone
        client = await this.clientsRepository.findByPhone(
          input.companyId,
          normalizedPhone,
        );
      }
    } else if (!sanitizeCustomerName(client.name) && sanitizedPushName) {
      // Substitui automaticamente nomes placeholder (ex.: "Cliente Teste", "Cliente") pelo nome real do WhatsApp.
      try {
        client = await this.clientsRepository.update(
          client.update({ name: sanitizedPushName }),
        );
      } catch {
        // Atualização automática de nome é melhor esforço e não deve bloquear o atendimento.
      }
    }

    // Resolve o nome real para a IA na ordem: nome salvo em `clients` -> `pushName` do WhatsApp -> `null`.
    // Nunca repassa placeholder literal como "Cliente" ou "Cliente Teste" para o agente conversacional.
    let resolvedDisplayName = resolveCustomerDisplayName({
      clientName: client?.name,
      pushName: sanitizedPushName,
    });

    // 3. Upsert da conversa e gravação idempotente da mensagem INBOUND
    let conversation = await this.conversationsRepository.upsertInbound({
      companyId: input.companyId,
      phone: normalizedPhone,
      clientId: client?.id ?? null,
      contactName: resolvedDisplayName,
      sentAt,
      incrementUnread: true,
    });

    // Se o pushName veio vazio neste turno, aproveita o contactName real salvo na conversa do WhatsApp
    // e corrige automaticamente `clients.name` caso ainda esteja com placeholder.
    if (!resolvedDisplayName) {
      const sanitizedConversationName = sanitizeCustomerName(
        conversation.contactName,
      );
      if (sanitizedConversationName) {
        resolvedDisplayName = sanitizedConversationName;
        if (client && !sanitizeCustomerName(client.name)) {
          try {
            client = await this.clientsRepository.update(
              client.update({ name: sanitizedConversationName }),
            );
          } catch {
            // Melhor esforço para não interromper o fluxo de resposta.
          }
        }
      }
    }

    const inboundEntity = WhatsAppMessage.create({
      companyId: input.companyId,
      conversationId: conversation.id,
      externalMessageId: input.externalMessageId ?? null,
      direction: "INBOUND",
      senderType: "CLIENT",
      content: trimmedContent,
      metadata: {
        source: input.source ?? "WEBHOOK",
      },
      sentAt,
    });

    const { message: savedInbound, created } =
      await this.messagesRepository.createIdempotent(inboundEntity);

    if (!created) {
      const originalConversation = savedInbound.conversationId === conversation.id
        ? conversation
        : await this.conversationsRepository.findById(input.companyId, savedInbound.conversationId);
      if (!originalConversation) throw new Error("Conversa da mensagem duplicada não encontrada.");
      return {
        duplicated: true,
        conversation: originalConversation.toDTO(savedInbound.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: null,
        aiScheduled: false,
        aiActions: [],
      };
    }

    // 4. Intercepta resposta de avaliação pós-atendimento (NPS 1 a 5) antes do agente de agendamento
    if (this.npsReplyHandler) {
      const npsResult = await this.npsReplyHandler.tryHandleInboundReply({
        companyId: input.companyId,
        conversation,
        phone: normalizedPhone,
        content: trimmedContent,
        now: sentAt,
      });
      if (npsResult.handled) {
        const finalConversation = npsResult.conversation ?? conversation;
        return {
          duplicated: false,
          conversation: finalConversation.toDTO(
            npsResult.outboundMessage?.content ?? savedInbound.content,
          ),
          inboundMessage: savedInbound.toDTO(),
          outboundMessage: npsResult.outboundMessage?.toDTO() ?? null,
          aiScheduled: false,
          aiActions: [],
          blockedReason: "NPS_HANDLED",
        };
      }
    }

    // 5. Trava de pausa (aiPausedUntil): se a IA estiver pausada no futuro, apenas mantém na inbox
    if (
      conversation.aiPausedUntil &&
      conversation.aiPausedUntil.getTime() > sentAt.getTime()
    ) {
      this.analyzeConversationUseCase?.triggerAsync({
        companyId: input.companyId,
        conversationId: conversation.id,
      });

      return {
        duplicated: false,
        conversation: conversation.toDTO(savedInbound.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: null,
        aiScheduled: false,
        aiActions: [],
        blockedReason: "AI_PAUSED",
      };
    }

    // 6. Verifica se o Piloto Automático de IA está habilitado na empresa e nesta conversa
    const connection = await this.connectionsRepository.findByCompanyId(
      input.companyId,
    );
    const aiAutopilotEnabled = connection?.aiAutopilotEnabled ?? true;

    if (conversation.assignedMode !== "AI_AUTOPILOT" || !aiAutopilotEnabled) {
      this.analyzeConversationUseCase?.triggerAsync({
        companyId: input.companyId,
        conversationId: conversation.id,
      });

      return {
        duplicated: false,
        conversation: conversation.toDTO(savedInbound.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: null,
        aiScheduled: false,
        aiActions: [],
      };
    }

    // 7. Rate-limit anti-spam por telefone (> 15 mensagens em 1 hora sem concluir agendamento)
    const windowExpired =
      !conversation.hourlyWindowStartAt ||
      sentAt.getTime() - conversation.hourlyWindowStartAt.getTime() >=
        ANTI_SPAM_WINDOW_MS;
    const nextWindowStart = windowExpired
      ? sentAt
      : conversation.hourlyWindowStartAt!;
    const nextHourlyCount = windowExpired
      ? 1
      : conversation.hourlyMessageCount + 1;

    if (this.conversationsRepository.updateHourlyRateLimit) {
      conversation =
        (await this.conversationsRepository.updateHourlyRateLimit({
          companyId: input.companyId,
          conversationId: conversation.id,
          hourlyMessageCount: nextHourlyCount,
          hourlyWindowStartAt: nextWindowStart,
        })) ?? conversation;
    }

    if (nextHourlyCount > ANTI_SPAM_HOURLY_LIMIT) {
      const aiPausedUntil = new Date(sentAt.getTime() + AI_AUTO_PAUSE_MS);
      this.turnOrchestrator.cancelTurn(input.companyId, conversation.id);

      if (this.conversationsRepository.updateAiPauseState) {
        conversation =
          (await this.conversationsRepository.updateAiPauseState({
            companyId: input.companyId,
            conversationId: conversation.id,
            aiPausedUntil,
          })) ?? conversation;
      }

      let externalReferenceId: string | null = null;
      try {
        const dispatch = await this.turnOrchestrator.sendImmediateText({
          tenantId: input.companyId,
          to: normalizedPhone,
          text: ANTI_SPAM_FIXED_REPLY,
          purpose: "RECEPTION",
        });
        externalReferenceId = dispatch.externalMessageId ?? null;
      } catch {
        // Mesmo em falha de rede, mantém a pausa aplicada e registra na inbox.
      }

      const antiSpamOutbound = WhatsAppMessage.create({
        companyId: input.companyId,
        conversationId: conversation.id,
        externalMessageId: externalReferenceId,
        direction: "OUTBOUND",
        senderType: "AI_AGENT",
        content: ANTI_SPAM_FIXED_REPLY,
        metadata: {
          antiSpamTriggered: true,
          hourlyMessageCount: nextHourlyCount,
          aiPausedUntil: aiPausedUntil.toISOString(),
        },
        sentAt,
      });

      const { message: savedAntiSpam } =
        await this.messagesRepository.createIdempotent(antiSpamOutbound);

      conversation =
        (await this.conversationsRepository.touchAfterOutbound({
          companyId: input.companyId,
          conversationId: conversation.id,
          sentAt,
          status: "OPEN",
        })) ?? conversation;

      return {
        duplicated: false,
        conversation: conversation.toDTO(savedAntiSpam.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: savedAntiSpam.toDTO(),
        aiScheduled: false,
        aiActions: [],
        blockedReason: "ANTI_SPAM",
      };
    }

    const debounceMs =
      input.debounceMs ??
      (input.source === "SIMULATOR"
        ? 0
        : this.turnOrchestrator.getDefaultDebounceMs() ??
          DEFAULT_INBOUND_DEBOUNCE_MS);

    const typingDelayMs =
      input.typingDelayMs ??
      (input.source === "SIMULATOR"
        ? 0
        : this.turnOrchestrator.getDefaultTypingDelayMs());

    const conversationId = conversation.id;
    const clientId = client?.id ?? null;
    const aiSystemPrompt = connection?.aiSystemPrompt ?? null;

    const replyToTurn = async (latestMessage: string, now: Date) => {
      const freshConversation = await this.conversationsRepository.findById(
        input.companyId,
        conversationId,
      );
      if (
        !freshConversation ||
        freshConversation.assignedMode !== "AI_AUTOPILOT" ||
        (freshConversation.aiPausedUntil && freshConversation.aiPausedUntil > now)
      ) {
        return null;
      }

      return this.runAiReply({
        companyId: input.companyId,
        conversation: freshConversation,
        clientId,
        clientName: resolvedDisplayName,
        phone: normalizedPhone,
        latestMessage,
        aiSystemPrompt,
        typingDelayMs,
        now,
      });
    };

    // 8. Agrupa mensagens do webhook antes de entrar na fila da conversa.
    if (debounceMs > 0) {
      this.analyzeConversationUseCase?.triggerAsync({
        companyId: input.companyId,
        conversationId: conversation.id,
      });

      this.turnOrchestrator.scheduleTurn({
        tenantId: input.companyId,
        conversationId,
        message: trimmedContent,
        debounceMs,
        onFlush: async (mergedMessage) => {
          await replyToTurn(mergedMessage, new Date());
        },
      });

      return {
        duplicated: false,
        conversation: conversation.toDTO(savedInbound.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: null,
        aiScheduled: true,
        aiActions: [],
      };
    }

    // 9. Execução imediata (simulador / testes síncronos)
    const aiResult = await this.turnOrchestrator.runSerially(
      input.companyId,
      conversationId,
      () => replyToTurn(trimmedContent, sentAt),
    );

    return {
      duplicated: false,
      conversation: (aiResult?.conversation ?? conversation).toDTO(
        aiResult?.outboundMessage?.content ?? savedInbound.content,
      ),
      inboundMessage: savedInbound.toDTO(),
      outboundMessage: aiResult?.outboundMessage?.toDTO() ?? null,
      aiScheduled: false,
      aiActions: aiResult?.actions ?? [],
      ...(aiResult?.blockedReason ? { blockedReason: aiResult.blockedReason } : {}),
    };
  }

  private async runAiReply(params: {
    companyId: string;
    conversation: WhatsAppConversation;
    clientId: string | null;
    clientName: string | null;
    phone: string;
    latestMessage: string;
    aiSystemPrompt: string | null;
    typingDelayMs: number;
    now: Date;
  }): Promise<{
    conversation: WhatsAppConversation;
    outboundMessage: WhatsAppMessage | null;
    actions: AiExecutedToolAction[];
    blockedReason?: "QUOTA_EXCEEDED" | undefined;
  } | null> {
    // Valida cota mensal de Sessões IA (com reutilização de sessão na janela de 6h) antes de chamar o Gemini
    if (this.planQuotaGuard) {
      const sessionCheck = await this.planQuotaGuard.registerOrReuseAiSession({
        tenantId: params.companyId,
        conversationId: params.conversation.id,
        now: params.now,
      });

      if (!sessionCheck.allowed) {
        if (this.proactiveInsightsWriter) {
          await this.proactiveInsightsWriter
            .createInsight({
              tenantId: params.companyId,
              module: "WHATSAPP",
              type: "AI_QUOTA_REACHED",
              title: "Limite mensal de atendimentos da Recepcionista IA atingido",
              description:
                sessionCheck.reason ??
                "Sua cota mensal de sessões IA atingiu 100%. Novas mensagens aguardam atendimento humano na inbox.",
              impactLabel: `${sessionCheck.usage.aiSessions.used}/${sessionCheck.usage.aiSessions.limit} sessões`,
              actionPayload: {
                conversationId: params.conversation.id,
                planName: sessionCheck.usage.planName,
                periodMonth: sessionCheck.usage.periodMonth,
              },
            })
            .catch(() => undefined);
        }

        return {
          conversation: params.conversation,
          outboundMessage: null,
          actions: [],
          blockedReason: "QUOTA_EXCEEDED",
        };
      }
    }

    const contextBundle = await this.aiContextProvider.buildContextAndTools({
      companyId: params.companyId,
      aiSystemPrompt: params.aiSystemPrompt,
      clientId: params.clientId,
      clientName: params.clientName,
      clientPhone: params.phone,
    });

    if (!contextBundle) {
      return null;
    }

    // Janela deslizante estrita: envia no máximo as últimas 10 mensagens para o modelo.
    const recentMessages =
      await this.messagesRepository.listRecentByConversation(
        params.companyId,
        params.conversation.id,
        10,
      );

    // Mantém presença "composing" ("digitando...") ativa durante toda a inferência do Gemini
    // (renovando a cada 3500ms) e garante limpeza do timer no bloco finally antes de enviar o texto.
    const stopComposingHeartbeat = this.turnOrchestrator.startComposingHeartbeat({
      tenantId: params.companyId,
      to: params.phone,
    });

    let aiOutput: AiBookingAgentOutput;
    try {
      aiOutput = await this.aiAgent.generateReply({
        company: contextBundle.company,
        client: {
          id: params.clientId,
          name: params.clientName,
          phone: params.phone,
        },
        history: recentMessages.map((msg) => ({
          direction: msg.direction,
          senderType: msg.senderType,
          content: msg.content,
          sentAt: msg.sentAt.toISOString(),
        })),
        latestClientMessage: params.latestMessage,
        now: params.now,
        tools: contextBundle.tools,
      });
    } finally {
      stopComposingHeartbeat();
    }

    // Registra tokens reais consumidos pelo Gemini na tabela ai_usage_logs e tenant_usage_metrics
    if (this.planQuotaGuard) {
      await this.planQuotaGuard
        .recordAiUsage({
          tenantId: params.companyId,
          feature: "BOOKING",
          model: aiOutput.usage?.model ?? aiOutput.provider,
          promptTokens: aiOutput.usage?.promptTokens ?? 0,
          completionTokens: aiOutput.usage?.completionTokens ?? 0,
          metadata: {
            conversationId: params.conversation.id,
            provider: aiOutput.provider,
            converted: Boolean(aiOutput.converted),
          },
          now: params.now,
        })
        .catch(() => undefined);
    }

    let currentConversation = params.conversation;

    // Se concluiu agendamento, zera contador horário anti-spam da conversa
    if (aiOutput.converted && this.conversationsRepository.updateHourlyRateLimit) {
      currentConversation =
        (await this.conversationsRepository.updateHourlyRateLimit({
          companyId: params.companyId,
          conversationId: currentConversation.id,
          hourlyMessageCount: 0,
          hourlyWindowStartAt: params.now,
        })) ?? currentConversation;
    }

    // Se o modelo sinalizou transbordo humano (request_human_handoff), pausa a IA e passa para HUMAN
    if (aiOutput.handoffRequested && this.conversationsRepository.updateAiPauseState) {
      const pauseUntil = new Date(params.now.getTime() + AI_AUTO_PAUSE_MS);
      currentConversation =
        (await this.conversationsRepository.updateAiPauseState({
          companyId: params.companyId,
          conversationId: currentConversation.id,
          aiPausedUntil: pauseUntil,
          assignedMode: "HUMAN",
        })) ?? currentConversation;
    }

    const sentAt = new Date();
    let externalReferenceId: string | null = null;
    let deliveryError: string | null = null;

    try {
      const dispatchResult = await this.turnOrchestrator.sendHumanizedReply({
        tenantId: params.companyId,
        to: params.phone,
        text: aiOutput.replyText,
        purpose: "RECEPTION",
        typingDelayMs: params.typingDelayMs,
        skipInitialComposing: true,
      });
      externalReferenceId = dispatchResult.externalMessageId ?? null;
    } catch (error) {
      deliveryError =
        error instanceof Error ? error.message : "Canal indisponível";
    }

    const outboundEntity = WhatsAppMessage.create({
      companyId: params.companyId,
      conversationId: currentConversation.id,
      externalMessageId: externalReferenceId,
      direction: "OUTBOUND",
      senderType: "AI_AGENT",
      content: aiOutput.replyText,
      metadata: {
        aiProvider: aiOutput.provider,
        actions: aiOutput.actions,
        ...(aiOutput.handoffRequested
          ? { handoffRequested: aiOutput.handoffRequested }
          : {}),
        ...(deliveryError ? { deliveryError } : {}),
      },
      sentAt,
    });

    const { message: savedOutbound } =
      await this.messagesRepository.createIdempotent(outboundEntity);

    const updatedConversation =
      (await this.conversationsRepository.touchAfterOutbound({
        companyId: params.companyId,
        conversationId: currentConversation.id,
        sentAt,
        ...(aiOutput.handoffRequested ? { assignedMode: "HUMAN" as const } : {}),
        status: aiOutput.converted ? "CONVERTED" : "WAITING_CLIENT",
      })) ?? currentConversation;

    // Atualiza o insight comercial de forma assíncrona após a resposta da IA (ou conversão de agendamento)
    this.analyzeConversationUseCase?.triggerAsync({
      companyId: params.companyId,
      conversationId: currentConversation.id,
      forceConverted: aiOutput.converted,
    });

    return {
      conversation: updatedConversation,
      outboundMessage: savedOutbound,
      actions: aiOutput.actions,
    };
  }
}
