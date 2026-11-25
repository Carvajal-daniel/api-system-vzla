import type { WhatsAppMessage } from "../entities/whatsapp-message.entity.js";

export interface WhatsAppMessagesRepository {
  findByExternalMessageId(
    companyId: string,
    externalMessageId: string,
  ): Promise<WhatsAppMessage | null>;

  // Persiste a mensagem garantindo idempotência quando externalMessageId já existir na empresa.
  createIdempotent(message: WhatsAppMessage): Promise<{
    message: WhatsAppMessage;
    created: boolean;
  }>;

  listByConversation(
    companyId: string,
    conversationId: string,
    limit?: number,
  ): Promise<WhatsAppMessage[]>;

  listRecentByConversation(
    companyId: string,
    conversationId: string,
    limit?: number,
  ): Promise<WhatsAppMessage[]>;
}
