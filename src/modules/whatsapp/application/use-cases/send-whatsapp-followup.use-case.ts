import type { WhatsAppConversationDTO } from "../../domain/entities/whatsapp-conversation.entity.js";
import {
  WhatsAppMessage,
  type WhatsAppMessageDTO,
} from "../../domain/entities/whatsapp-message.entity.js";
import { WhatsAppConversationNotFoundError } from "../../domain/errors/whatsapp-errors.js";
import type { AiConversationInsightsRepository } from "../../domain/repositories/ai-conversation-insights.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { AnalyzeWhatsAppConversationUseCase } from "./analyze-whatsapp-conversation.use-case.js";
import type { ConversationalDispatchPort } from "./process-inbound-whatsapp-message.use-case.js";

// Envia follow-up comercial em 1 clique usando a sugestão da IA (ou texto editado pelo dono)
// através do WhatsAppGatewayRouter e dispara reanálise assíncrona da conversa.
export class SendWhatsAppFollowupUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly insightsRepository: AiConversationInsightsRepository,
    private readonly gatewayRouter: ConversationalDispatchPort,
    private readonly analyzeConversationUseCase?: AnalyzeWhatsAppConversationUseCase,
  ) {}

  async execute(input: {
    companyId: string;
    conversationId: string;
    content?: string | undefined;
  }): Promise<{
    conversation: WhatsAppConversationDTO;
    message: WhatsAppMessageDTO;
  }> {
    const conversation = await this.conversationsRepository.findById(
      input.companyId,
      input.conversationId,
    );
    if (!conversation) {
      throw new WhatsAppConversationNotFoundError();
    }

    const insight = await this.insightsRepository.findByConversationId(
      input.companyId,
      conversation.id,
    );

    const greetingName = conversation.contactName?.trim().split(/\s+/)[0];
    const fallbackMessage = `Olá${greetingName ? `, ${greetingName}` : ""}! Tudo bem? Posso te ajudar a agendar seu horário conosco?`;
    const finalContent =
      input.content?.trim() ||
      insight?.suggestedFollowupReply?.trim() ||
      fallbackMessage;

    const sentAt = new Date();
    const dispatch = await this.gatewayRouter.send({
      purpose: "CONVERSATIONAL_REPLY",
      companyId: input.companyId,
      phone: conversation.phone,
      text: finalContent,
    });

    const outboundMessage = WhatsAppMessage.create({
      companyId: input.companyId,
      conversationId: conversation.id,
      externalMessageId: dispatch.referenceId,
      direction: "OUTBOUND",
      senderType: "OWNER",
      content: finalContent,
      metadata: {
        kind: "FOLLOWUP",
        deliveryProvider: dispatch.provider,
      },
      sentAt,
    });

    const { message: savedMessage } =
      await this.messagesRepository.createIdempotent(outboundMessage);

    const updatedConversation =
      (await this.conversationsRepository.touchAfterOutbound({
        companyId: input.companyId,
        conversationId: conversation.id,
        sentAt,
        assignedMode: "HUMAN",
        status:
          conversation.status === "CONVERTED" ? "CONVERTED" : "WAITING_CLIENT",
      })) ?? conversation;

    this.analyzeConversationUseCase?.triggerAsync({
      companyId: input.companyId,
      conversationId: conversation.id,
    });

    return {
      conversation: updatedConversation.toDTO(savedMessage.content),
      message: savedMessage.toDTO(),
    };
  }
}
