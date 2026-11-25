import type { WhatsAppConversationDTO } from "../../domain/entities/whatsapp-conversation.entity.js";
import {
  WhatsAppMessage,
  type WhatsAppMessageDTO,
} from "../../domain/entities/whatsapp-message.entity.js";
import { WhatsAppConversationNotFoundError } from "../../domain/errors/whatsapp-errors.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { AnalyzeWhatsAppConversationUseCase } from "./analyze-whatsapp-conversation.use-case.js";
import type { ConversationalDispatchPort } from "./process-inbound-whatsapp-message.use-case.js";

// Envia mensagem manual pelo proprietário (OWNER), assume automaticamente o atendimento (HUMAN)
// e dispara pelo WhatsAppGatewayRouter no canal conversacional 1-a-1.
export class SendOwnerWhatsAppMessageUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly gatewayRouter: ConversationalDispatchPort,
    private readonly analyzeConversationUseCase?: AnalyzeWhatsAppConversationUseCase,
  ) {}

  async execute(input: {
    companyId: string;
    conversationId: string;
    content: string;
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

    const trimmedContent = input.content.trim();
    const sentAt = new Date();

    const dispatch = await this.gatewayRouter.send({
      purpose: "CONVERSATIONAL_REPLY",
      companyId: input.companyId,
      phone: conversation.phone,
      text: trimmedContent,
    });

    const outboundMessage = WhatsAppMessage.create({
      companyId: input.companyId,
      conversationId: conversation.id,
      externalMessageId: dispatch.referenceId,
      direction: "OUTBOUND",
      senderType: "OWNER",
      content: trimmedContent,
      metadata: {
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
        status: "WAITING_CLIENT",
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
