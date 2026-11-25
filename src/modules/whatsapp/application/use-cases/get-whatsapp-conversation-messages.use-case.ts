import type { WhatsAppConversationDTO } from "../../domain/entities/whatsapp-conversation.entity.js";
import type { WhatsAppMessageDTO } from "../../domain/entities/whatsapp-message.entity.js";
import { WhatsAppConversationNotFoundError } from "../../domain/errors/whatsapp-errors.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";

export class GetWhatsAppConversationMessagesUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
  ) {}

  async execute(input: {
    companyId: string;
    conversationId: string;
  }): Promise<{
    conversation: WhatsAppConversationDTO;
    messages: WhatsAppMessageDTO[];
  }> {
    const conversation = await this.conversationsRepository.findById(
      input.companyId,
      input.conversationId,
    );

    if (!conversation) {
      throw new WhatsAppConversationNotFoundError();
    }

    const [messages] = await Promise.all([
      this.messagesRepository.listByConversation(
        input.companyId,
        input.conversationId,
      ),
      conversation.unreadCount > 0
        ? this.conversationsRepository.resetUnreadCount(
            input.companyId,
            input.conversationId,
          )
        : Promise.resolve(),
    ]);

    const dto = conversation.toDTO(
      messages[messages.length - 1]?.content ?? null,
    );
    dto.unreadCount = 0;

    return {
      conversation: dto,
      messages: messages.map((msg) => msg.toDTO()),
    };
  }
}
