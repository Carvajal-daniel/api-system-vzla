import { isEvolutionApiConfigured } from "../../../../../shared/config/env.js";
import type {
  ChannelStatus,
  MaskedChannelCredentials,
  SendMessageResult,
  SendPresenceParams,
  SendTemplateParams,
  SendTextParams,
  WhatsAppGatewayPort,
  WhatsAppSendPurpose,
} from "../../../application/ports/whatsapp-gateway.port.js";
import type {
  TenantWhatsAppChannelProvider,
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
} from "../../../domain/repositories/tenant-whatsapp-channels.repository.js";
import { EvolutionWhatsAppAdapter } from "./evolution-whatsapp.adapter.js";
import { MockWhatsAppAdapter } from "./mock-whatsapp.adapter.js";

function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 4) {
    return "****";
  }
  return `****${trimmed.slice(-4)}`;
}

// Sanitiza credenciais antes de qualquer retorno de status ou log,
// impedindo vazamento de accessToken, apiKey ou outros segredos do jsonb.
export function maskChannelCredentials(
  credentials: Record<string, unknown>,
): MaskedChannelCredentials {
  const masked: MaskedChannelCredentials = {};

  if (
    typeof credentials["instanceName"] === "string" &&
    credentials["instanceName"].trim().length > 0
  ) {
    masked.instanceName = credentials["instanceName"].trim();
  }

  if (
    typeof credentials["phoneNumberId"] === "string" &&
    credentials["phoneNumberId"].trim().length > 0
  ) {
    masked.phoneNumberId = credentials["phoneNumberId"].trim();
  }

  if (
    typeof credentials["wabaId"] === "string" &&
    credentials["wabaId"].trim().length > 0
  ) {
    masked.wabaId = credentials["wabaId"].trim();
  }

  if (
    typeof credentials["accessToken"] === "string" &&
    credentials["accessToken"].trim().length > 0
  ) {
    masked.hasAccessToken = true;
    masked.accessTokenMasked = maskSecret(credentials["accessToken"]);
  }

  if (
    typeof credentials["apiKey"] === "string" &&
    credentials["apiKey"].trim().length > 0
  ) {
    masked.hasApiKey = true;
    masked.apiKeyMasked = maskSecret(credentials["apiKey"]);
  }

  return masked;
}

// Roteador híbrido de canais WhatsApp: seleciona o canal ativo do tenant conforme a finalidade
// (CAMPAIGN prioriza CAMPAIGNS_ONLY -> ALL; RECEPTION prioriza RECEPTION_ONLY -> ALL)
// e faz fallback seguro para MockWhatsAppAdapter quando nenhum canal externo estiver conectado.
export class WhatsAppGatewayRouter implements WhatsAppGatewayPort {
  private defaultEvolutionAdapter: WhatsAppGatewayPort | null = null;

  constructor(
    private readonly channelsRepository: TenantWhatsAppChannelsRepository,
    private readonly mockAdapter: WhatsAppGatewayPort = new MockWhatsAppAdapter(),
    private readonly providerAdapters: Partial<
      Record<TenantWhatsAppChannelProvider, WhatsAppGatewayPort>
    > = {},
  ) {}

  public async sendText(params: SendTextParams): Promise<SendMessageResult> {
    const purpose: WhatsAppSendPurpose = params.purpose ?? "RECEPTION";
    const adapter = await this.resolveAdapter(params.tenantId, purpose);
    return adapter.sendText({ ...params, purpose });
  }

  public async sendTemplate(
    params: SendTemplateParams,
  ): Promise<SendMessageResult> {
    const adapter = await this.resolveAdapter(params.tenantId, "CAMPAIGN");
    return adapter.sendTemplate(params);
  }

  public async sendPresence(params: SendPresenceParams): Promise<void> {
    const adapter = await this.resolveAdapter(params.tenantId, "RECEPTION");
    return adapter.sendPresence(params);
  }

  public async getChannelsStatus(tenantId: string): Promise<ChannelStatus[]> {
    const channels = await this.channelsRepository.listByTenant(tenantId);

    if (channels.length === 0) {
      return this.mockAdapter.getChannelsStatus(tenantId);
    }

    return channels.map((channel) => ({
      id: channel.id,
      provider: channel.provider,
      purpose: channel.purpose,
      phoneNumber: channel.phoneNumber,
      status: channel.status,
      credentials: maskChannelCredentials(channel.credentials),
      updatedAt: channel.updatedAt.toISOString(),
    }));
  }

  private async resolveAdapter(
    tenantId: string,
    purpose: WhatsAppSendPurpose,
  ): Promise<WhatsAppGatewayPort> {
    const connectedChannels =
      await this.channelsRepository.listConnectedByTenant(tenantId);

    const selected = this.selectChannelForPurpose(connectedChannels, purpose);
    if (!selected) {
      return this.mockAdapter;
    }

    const explicitAdapter = this.providerAdapters[selected.provider];
    if (explicitAdapter) {
      return explicitAdapter;
    }

    // Quando houver canal EVOLUTION conectado e a Evolution API estiver configurada, roteia automaticamente para o adaptador real.
    if (selected.provider === "EVOLUTION" && isEvolutionApiConfigured()) {
      this.defaultEvolutionAdapter ??= new EvolutionWhatsAppAdapter(
        this.channelsRepository,
      );
      return this.defaultEvolutionAdapter;
    }

    return this.mockAdapter;
  }

  private selectChannelForPurpose(
    connectedChannels: TenantWhatsAppChannelRecord[],
    purpose: WhatsAppSendPurpose,
  ): TenantWhatsAppChannelRecord | null {
    if (connectedChannels.length === 0) {
      return null;
    }

    const preferredPurpose =
      purpose === "CAMPAIGN" ? "CAMPAIGNS_ONLY" : "RECEPTION_ONLY";

    const dedicated = connectedChannels.find(
      (channel) => channel.purpose === preferredPurpose,
    );
    if (dedicated) {
      return dedicated;
    }

    const shared = connectedChannels.find(
      (channel) => channel.purpose === "ALL",
    );
    return shared ?? null;
  }
}
