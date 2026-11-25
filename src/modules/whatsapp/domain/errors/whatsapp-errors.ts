import { DomainError } from "../../../../shared/Errors/domain-error.js";

// Erro de domínio disparado quando uma campanha em massa tenta enviar sem Datafy ativo.
export class CampaignChannelNotConfiguredError extends DomainError {
  constructor(
    message = "O canal oficial de campanhas (Datafy) não está configurado ou ativo para esta empresa.",
  ) {
    super(message, "CONFLICT", "CAMPAIGN_CHANNEL_NOT_CONFIGURED");
  }
}

export class InvalidDatafyCredentialsError extends DomainError {
  constructor(
    message = "As credenciais da API Datafy são inválidas ou incompletas.",
  ) {
    super(message, "VALIDATION", "INVALID_DATAFY_CREDENTIALS");
  }
}

export class WhatsAppChannelUnavailableError extends DomainError {
  constructor(
    message = "O canal de WhatsApp da empresa não está conectado para envio de mensagens.",
  ) {
    super(message, "CONFLICT", "WHATSAPP_CHANNEL_UNAVAILABLE");
  }
}

export class WhatsAppConversationNotFoundError extends DomainError {
  constructor(message = "Conversa de WhatsApp não encontrada.") {
    super(message, "NOT_FOUND", "WHATSAPP_CONVERSATION_NOT_FOUND");
  }
}
