import type { EvolutionConnectionStatus } from "../../domain/entities/company-whatsapp-connection.entity.js";

export interface ConversationalStatusResult {
  instanceName: string;
  status: EvolutionConnectionStatus;
  phoneNumber: string | null;
  mode: "LIVE" | "MOCK_READY";
}

export interface ConnectQrCodeResult {
  instanceName: string;
  status: EvolutionConnectionStatus;
  qrCodeBase64: string | null;
  pairingCode?: string | null;
  phoneNumber: string | null;
  mode: "LIVE" | "MOCK_READY";
}

export interface SendConversationalTextInput {
  companyId: string;
  instanceName?: string | null | undefined;
  phone: string;
  text: string;
}

export interface SendConversationalTextResult {
  messageId: string;
  provider: "EVOLUTION" | "MOCK_READY";
}

// Porta de atendimento conversacional 1-a-1 (Evolution API).
export interface WhatsAppConversationalPort {
  getStatus(companyId: string, instanceName?: string | null): Promise<ConversationalStatusResult>;
  connectAndGetQrCode(companyId: string, instanceName?: string | null): Promise<ConnectQrCodeResult>;
  disconnect(companyId: string, instanceName?: string | null): Promise<void>;
  sendTextMessage(input: SendConversationalTextInput): Promise<SendConversationalTextResult>;
}
