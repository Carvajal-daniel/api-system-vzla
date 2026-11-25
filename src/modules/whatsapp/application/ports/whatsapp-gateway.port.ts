export type WhatsAppSendPurpose = "RECEPTION" | "CAMPAIGN";

export type WhatsAppPresenceState = "composing" | "paused";

export type GatewayChannelProvider = "EVOLUTION" | "META_OFFICIAL" | "MOCK";

export type GatewayChannelPurpose = "ALL" | "RECEPTION_ONLY" | "CAMPAIGNS_ONLY";

export type GatewayChannelConnectionStatus =
  | "CONNECTED"
  | "DISCONNECTED"
  | "QRCODE_PENDING";

export interface MaskedChannelCredentials {
  instanceName?: string;
  phoneNumberId?: string;
  wabaId?: string;
  hasAccessToken?: boolean;
  accessTokenMasked?: string;
  hasApiKey?: boolean;
  apiKeyMasked?: string;
}

export interface ChannelStatus {
  id: string;
  provider: GatewayChannelProvider;
  purpose: GatewayChannelPurpose;
  phoneNumber: string | null;
  status: GatewayChannelConnectionStatus;
  credentials: MaskedChannelCredentials;
  updatedAt: string;
}

export interface SendTextParams {
  tenantId: string;
  to: string;
  text: string;
  purpose?: WhatsAppSendPurpose;
}

export interface SendTemplateParams {
  tenantId: string;
  to: string;
  templateName: string;
  variables: Record<string, string>;
}

export interface SendPresenceParams {
  tenantId: string;
  to: string;
  presence: WhatsAppPresenceState;
}

export interface SendMessageResult {
  externalMessageId?: string;
}

// Porta hexagonal de saída para comunicação com WhatsApp.
// Desacopla completamente os casos de uso de provedores concretos (Evolution, Meta Oficial ou Mock).
export interface WhatsAppGatewayPort {
  sendText(params: SendTextParams): Promise<SendMessageResult>;

  sendTemplate(params: SendTemplateParams): Promise<SendMessageResult>;

  sendPresence(params: SendPresenceParams): Promise<void>;

  getChannelsStatus(tenantId: string): Promise<ChannelStatus[]>;
}
