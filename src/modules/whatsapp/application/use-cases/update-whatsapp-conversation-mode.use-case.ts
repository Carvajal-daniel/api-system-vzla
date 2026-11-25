import type {
  WhatsAppAssignedMode,
  WhatsAppConversationDTO,
} from "../../domain/entities/whatsapp-conversation.entity.js";
import { WhatsAppConversationNotFoundError } from "../../domain/errors/whatsapp-errors.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";

export class UpdateWhatsAppConversationModeUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
  ) {}

  async execute(input: {
    companyId: string;
    conversationId: string;
    assignedMode: WhatsAppAssignedMode;
  }): Promise<{ conversation: WhatsAppConversationDTO }> {
    const updated = await this.conversationsRepository.updateAssignedMode(
      input.companyId,
      input.conversationId,
      input.assignedMode,
    );

    if (!updated) {
      throw new WhatsAppConversationNotFoundError();
    }

    return { conversation: updated.toDTO() };
  }
}
