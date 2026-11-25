import { Client } from "../../../clients/domain/entities/client.entity.js";
import type { ClientsRepository } from "../../../clients/domain/repositories/clients.repository.js";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
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
  AiBookingAgentPort,
  AiExecutedToolAction,
} from "../ports/ai-booking-agent.port.js";
import type { AiBookingContextProviderPort } from "../ports/ai-booking-context-provider.port.js";
import type { AnalyzeWhatsAppConversationUseCase } from "./analyze-whatsapp-conversation.use-case.js";

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

export interface ProcessInboundWhatsAppMessageInput {
  companyId: string;
  phone: string;
  contactName?: string | null | undefined;
  content: string;
  externalMessageId?: string | null | undefined;
  sentAt?: Date | undefined;
  source?: "WEBHOOK" | "SIMULATOR" | undefined;
  // Janela de debounce em ms (3000ms no webhook para agrupar mensagens seguidas; 0ms no simulador/testes).
  debounceMs?: number | undefined;
}

export interface ProcessInboundWhatsAppMessageOutput {
  duplicated: boolean;
  conversation: WhatsAppConversationDTO;
  inboundMessage: WhatsAppMessageDTO;
  outboundMessage: WhatsAppMessageDTO | null;
  aiScheduled: boolean;
  aiActions: AiExecutedToolAction[];
}

interface PendingDebounceEntry {
  timer: ReturnType<typeof setTimeout>;
  latestMessage: string;
  clientId: string | null;
  clientName: string;
  phone: string;
  aiSystemPrompt: string | null;
}

// Caso de uso central do Bloco 2: recebe mensagens de clientes, garante cliente/conversa/idempotência
// e aciona o agente de IA quando o piloto automático estiver ativo (com debounce seguro de até 3s no webhook).
export class ProcessInboundWhatsAppMessageUseCase {
  private readonly pendingDebounces = new Map<string, PendingDebounceEntry>();

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly connectionsRepository: CompanyWhatsAppConnectionRepository,
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly aiAgent: AiBookingAgentPort,
    private readonly aiContextProvider: AiBookingContextProviderPort,
    private readonly gatewayRouter: ConversationalDispatchPort,
    private readonly analyzeConversationUseCase?: AnalyzeWhatsAppConversationUseCase,
  ) {}

  async execute(
    input: ProcessInboundWhatsAppMessageInput,
  ): Promise<ProcessInboundWhatsAppMessageOutput> {
    const normalizedPhone = Phone.create(input.phone).value;
    const trimmedContent = input.content.trim();
    const sentAt = input.sentAt ?? new Date();
    const cleanContactName = input.contactName?.trim() || null;

    // 1. Idempotência antecipada se externalMessageId já foi processado para esta empresa
    if (input.externalMessageId?.trim()) {
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

    // 2. Resolve ou cria o cliente normalizado em `clients` por (companyId, phone)
    let client = await this.clientsRepository.findByPhone(
      input.companyId,
      normalizedPhone,
    );
    if (!client) {
      const fallbackName =
        cleanContactName && cleanContactName.length >= 2
          ? cleanContactName
          : `Cliente ${normalizedPhone.slice(-4)}`;
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
    }

    const resolvedName =
      cleanContactName ?? client?.name ?? `Cliente ${normalizedPhone.slice(-4)}`;

    // 3. Upsert da conversa e gravação idempotente da mensagem INBOUND
    const conversation = await this.conversationsRepository.upsertInbound({
      companyId: input.companyId,
      phone: normalizedPhone,
      clientId: client?.id ?? null,
      contactName: resolvedName,
      sentAt,
      incrementUnread: true,
    });

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
      return {
        duplicated: true,
        conversation: conversation.toDTO(savedInbound.content),
        inboundMessage: savedInbound.toDTO(),
        outboundMessage: null,
        aiScheduled: false,
        aiActions: [],
      };
    }

    // 4. Verifica se o Piloto Automático de IA está habilitado na empresa e nesta conversa
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

    const debounceMs =
      input.debounceMs ?? (input.source === "SIMULATOR" ? 0 : 3_000);

    // 5. No webhook real, aplica debounce de até 3 segundos para agrupar mensagens consecutivas
    if (debounceMs > 0) {
      this.analyzeConversationUseCase?.triggerAsync({
        companyId: input.companyId,
        conversationId: conversation.id,
      });

      this.scheduleDebouncedAiReply({
        companyId: input.companyId,
        conversationId: conversation.id,
        clientId: client?.id ?? null,
        clientName: resolvedName,
        phone: normalizedPhone,
        latestMessage: trimmedContent,
        aiSystemPrompt: connection?.aiSystemPrompt ?? null,
        debounceMs,
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

    // 6. Execução imediata (simulador / testes síncronos)
    const aiResult = await this.runAiReply({
      companyId: input.companyId,
      conversation,
      clientId: client?.id ?? null,
      clientName: resolvedName,
      phone: normalizedPhone,
      latestMessage: trimmedContent,
      aiSystemPrompt: connection?.aiSystemPrompt ?? null,
    });

    return {
      duplicated: false,
      conversation: (aiResult?.conversation ?? conversation).toDTO(
        aiResult?.outboundMessage.content ?? savedInbound.content,
      ),
      inboundMessage: savedInbound.toDTO(),
      outboundMessage: aiResult?.outboundMessage.toDTO() ?? null,
      aiScheduled: false,
      aiActions: aiResult?.actions ?? [],
    };
  }

  private scheduleDebouncedAiReply(params: {
    companyId: string;
    conversationId: string;
    clientId: string | null;
    clientName: string;
    phone: string;
    latestMessage: string;
    aiSystemPrompt: string | null;
    debounceMs: number;
  }): void {
    const key = `${params.companyId}:${params.conversationId}`;
    const existing = this.pendingDebounces.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const mergedLatest = existing
      ? `${existing.latestMessage}\n${params.latestMessage}`
      : params.latestMessage;

    const timer = setTimeout(() => {
      const entry = this.pendingDebounces.get(key);
      this.pendingDebounces.delete(key);
      if (!entry) return;

      void this.conversationsRepository
        .findById(params.companyId, params.conversationId)
        .then(async (freshConversation) => {
          if (
            !freshConversation ||
            freshConversation.assignedMode !== "AI_AUTOPILOT"
          ) {
            return;
          }
          await this.runAiReply({
            companyId: params.companyId,
            conversation: freshConversation,
            clientId: entry.clientId,
            clientName: entry.clientName,
            phone: entry.phone,
            latestMessage: entry.latestMessage,
            aiSystemPrompt: entry.aiSystemPrompt,
          });
        })
        .catch(() => undefined);
    }, params.debounceMs);

    this.pendingDebounces.set(key, {
      timer,
      latestMessage: mergedLatest,
      clientId: params.clientId,
      clientName: params.clientName,
      phone: params.phone,
      aiSystemPrompt: params.aiSystemPrompt,
    });
  }

  private async runAiReply(params: {
    companyId: string;
    conversation: WhatsAppConversation;
    clientId: string | null;
    clientName: string;
    phone: string;
    latestMessage: string;
    aiSystemPrompt: string | null;
  }): Promise<{
    conversation: WhatsAppConversation;
    outboundMessage: WhatsAppMessage;
    actions: AiExecutedToolAction[];
  } | null> {
    const contextBundle = await this.aiContextProvider.buildContextAndTools({
      companyId: params.companyId,
      aiSystemPrompt: params.aiSystemPrompt,
      clientName: params.clientName,
      clientPhone: params.phone,
    });

    if (!contextBundle) {
      return null;
    }

    const recentMessages =
      await this.messagesRepository.listRecentByConversation(
        params.companyId,
        params.conversation.id,
        16,
      );

    const aiOutput = await this.aiAgent.generateReply({
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
      now: new Date(),
      tools: contextBundle.tools,
    });

    const sentAt = new Date();
    let externalReferenceId: string | null = null;
    let deliveryProvider: string = "SKIPPED";
    let deliveryError: string | null = null;

    try {
      const dispatchResult = await this.gatewayRouter.send({
        purpose: "CONVERSATIONAL_REPLY",
        companyId: params.companyId,
        phone: params.phone,
        text: aiOutput.replyText,
      });
      externalReferenceId = dispatchResult.referenceId;
      deliveryProvider = dispatchResult.provider;
    } catch (error) {
      deliveryError =
        error instanceof Error ? error.message : "Canal indisponível";
    }

    const outboundEntity = WhatsAppMessage.create({
      companyId: params.companyId,
      conversationId: params.conversation.id,
      externalMessageId: externalReferenceId,
      direction: "OUTBOUND",
      senderType: "AI_AGENT",
      content: aiOutput.replyText,
      metadata: {
        aiProvider: aiOutput.provider,
        actions: aiOutput.actions,
        deliveryProvider,
        ...(deliveryError ? { deliveryError } : {}),
      },
      sentAt,
    });

    const { message: savedOutbound } =
      await this.messagesRepository.createIdempotent(outboundEntity);

    const updatedConversation =
      (await this.conversationsRepository.touchAfterOutbound({
        companyId: params.companyId,
        conversationId: params.conversation.id,
        sentAt,
        status: aiOutput.converted ? "CONVERTED" : "WAITING_CLIENT",
      })) ?? params.conversation;

    // Atualiza o insight comercial de forma assíncrona após a resposta da IA (ou conversão de agendamento)
    this.analyzeConversationUseCase?.triggerAsync({
      companyId: params.companyId,
      conversationId: params.conversation.id,
      forceConverted: aiOutput.converted,
    });

    return {
      conversation: updatedConversation,
      outboundMessage: savedOutbound,
      actions: aiOutput.actions,
    };
  }
}
