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

export interface UpsertTenantWhatsAppChannelInput {
  tenantId: string;
  provider: TenantWhatsAppChannelProvider;
  purpose?: TenantWhatsAppChannelPurpose | undefined;
  phoneNumber?: string | null | undefined;
  status: TenantWhatsAppChannelStatus;
  credentials?: Record<string, unknown> | undefined;
}

// Contrato de domínio para leitura e gestão de canais híbridos de WhatsApp, sempre isolados por tenantId.
export interface TenantWhatsAppChannelsRepository {
  listByTenant(tenantId: string): Promise<TenantWhatsAppChannelRecord[]>;

  listConnectedByTenant(tenantId: string): Promise<TenantWhatsAppChannelRecord[]>;

  findByTenantAndProvider(
    tenantId: string,
    provider: TenantWhatsAppChannelProvider,
  ): Promise<TenantWhatsAppChannelRecord | null>;

  // Utilizado exclusivamente pelo webhook Evolution para resolver o tenantId real a partir da instância registrada no banco.
  findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<TenantWhatsAppChannelRecord | null>;

  upsertChannel(
    input: UpsertTenantWhatsAppChannelInput,
  ): Promise<TenantWhatsAppChannelRecord>;
}
