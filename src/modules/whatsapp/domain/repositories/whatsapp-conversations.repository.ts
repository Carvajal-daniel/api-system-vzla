import type {
  WhatsAppAssignedMode,
  WhatsAppConversation,
  WhatsAppConversationStatus,
} from "../entities/whatsapp-conversation.entity.js";

export interface ListWhatsAppConversationsFilter {
  search?: string | undefined;
  assignedMode?: WhatsAppAssignedMode | undefined;
  limit?: number | undefined;
}

export interface WhatsAppConversationListItem {
  conversation: WhatsAppConversation;
  lastMessagePreview: string | null;
}

export interface WhatsAppConversationsRepository {
  findById(
    companyId: string,
    conversationId: string,
  ): Promise<WhatsAppConversation | null>;

  findByCompanyAndPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<WhatsAppConversation | null>;

  upsertInbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    incrementUnread: boolean;
  }): Promise<WhatsAppConversation>;

  upsertOutbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode | undefined;
    status?: WhatsAppConversationStatus | undefined;
  }): Promise<WhatsAppConversation>;

  listByCompany(
    companyId: string,
    filter?: ListWhatsAppConversationsFilter,
  ): Promise<WhatsAppConversationListItem[]>;

  resetUnreadCount(companyId: string, conversationId: string): Promise<void>;

  updateAssignedMode(
    companyId: string,
    conversationId: string,
    assignedMode: WhatsAppAssignedMode,
  ): Promise<WhatsAppConversation | null>;

  updateStatus(
    companyId: string,
    conversationId: string,
    status: WhatsAppConversationStatus,
  ): Promise<WhatsAppConversation | null>;

  touchAfterOutbound(input: {
    companyId: string;
    conversationId: string;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode | undefined;
    status?: WhatsAppConversationStatus | undefined;
  }): Promise<WhatsAppConversation | null>;

  updateAiPauseState?(input: {
    companyId: string;
    conversationId: string;
    aiPausedUntil: Date | null;
    assignedMode?: WhatsAppAssignedMode | undefined;
  }): Promise<WhatsAppConversation | null>;

  updateHourlyRateLimit?(input: {
    companyId: string;
    conversationId: string;
    hourlyMessageCount: number;
    hourlyWindowStartAt: Date | null;
  }): Promise<WhatsAppConversation | null>;
}
