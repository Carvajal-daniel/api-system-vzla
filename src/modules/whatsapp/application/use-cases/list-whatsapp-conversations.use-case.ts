import type {
  WhatsAppAssignedMode,
  WhatsAppConversationDTO,
} from "../../domain/entities/whatsapp-conversation.entity.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";

export class ListWhatsAppConversationsUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
  ) {}

  async execute(input: {
    companyId: string;
    search?: string | undefined;
    assignedMode?: WhatsAppAssignedMode | undefined;
  }): Promise<{ conversations: WhatsAppConversationDTO[] }> {
    const items = await this.conversationsRepository.listByCompany(
      input.companyId,
      {
        search: input.search,
        assignedMode: input.assignedMode,
      },
    );

    return {
      conversations: items.map((item) =>
        item.conversation.toDTO(item.lastMessagePreview),
      ),
    };
  }
}
