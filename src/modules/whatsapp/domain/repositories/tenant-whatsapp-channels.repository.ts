export type TenantWhatsAppChannelProvider = "EVOLUTION" | "META_OFFICIAL";

export type TenantWhatsAppChannelPurpose =
  | "ALL"
  | "RECEPTION_ONLY"
  | "CAMPAIGNS_ONLY";

export type TenantWhatsAppChannelStatus =
  | "CONNECTED"
  | "DISCONNECTED"
  | "QRCODE_PENDING";

export interface TenantWhatsAppChannelRecord {
  id: string;
  tenantId: string;
  provider: TenantWhatsAppChannelProvider;
  purpose: TenantWhatsAppChannelPurpose;
  phoneNumber: string | null;
  status: TenantWhatsAppChannelStatus;
  credentials: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// Contrato de domínio para leitura de canais híbridos de WhatsApp, sempre isolados por tenantId.
export interface TenantWhatsAppChannelsRepository {
  listByTenant(tenantId: string): Promise<TenantWhatsAppChannelRecord[]>;

  listConnectedByTenant(tenantId: string): Promise<TenantWhatsAppChannelRecord[]>;
}
