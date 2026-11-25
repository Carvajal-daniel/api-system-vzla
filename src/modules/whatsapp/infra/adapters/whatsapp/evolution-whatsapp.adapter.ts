import {
  getEvolutionEnv,
  type EvolutionEnvConfig,
} from "../../../../../shared/config/env.js";
import type {
  ChannelStatus,
  SendMessageResult,
  SendPresenceParams,
  SendTemplateParams,
  SendTextParams,
  WhatsAppGatewayPort,
} from "../../../application/ports/whatsapp-gateway.port.js";
import { WhatsAppChannelUnavailableError } from "../../../domain/errors/whatsapp-errors.js";
import type {
  TenantWhatsAppChannelStatus,
  TenantWhatsAppChannelsRepository,
} from "../../../domain/repositories/tenant-whatsapp-channels.repository.js";
import { maskChannelCredentials } from "./whatsapp-gateway.router.js";

export interface EvolutionConnectInstanceResult {
  instanceName: string;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  status: TenantWhatsAppChannelStatus;
  phoneNumber: string | null;
}

export interface EvolutionConnectionStateResult {
  instanceName: string;
  status: TenantWhatsAppChannelStatus;
  phoneNumber: string | null;
}

// Gera nome de instância isolado por tenant (barbearia) para evitar colisão na Evolution API.
export function buildTenantEvolutionInstanceName(tenantId: string): string {
  const cleanPrefix = tenantId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  return `tenant_${cleanPrefix}`;
}

// Normaliza telefone para o padrão internacional exigido pela Evolution API (ex: 5511999990000),
// removendo '+', espaços, pontuação e sufixos JID duplicados.
export function formatEvolutionPhoneNumber(phone: string): string {
  const withoutJidSuffix = phone.trim().replace(/@.*$/, "");
  const digits = withoutJidSuffix.replace(/\D/g, "");

  if (digits.length < 10) {
    throw new Error(`Invalid WhatsApp destination phone: "${phone}"`);
  }

  // Números brasileiros informados sem DDI (10 ou 11 dígitos) recebem prefixo '55'.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  return digits;
}

export function normalizeEvolutionQrDataUri(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

export function mapEvolutionConnectionState(
  state: string | undefined | null,
): TenantWhatsAppChannelStatus {
  const normalized = (state ?? "").trim().toLowerCase();
  if (normalized === "open" || normalized === "connected") {
    return "CONNECTED";
  }
  if (normalized === "connecting" || normalized === "qrcode") {
    return "QRCODE_PENDING";
  }
  return "DISCONNECTED";
}

function extractOwnerPhone(owner: string | undefined | null): string | null {
  if (!owner) return null;
  const digits = owner.replace(/@.*$/, "").replace(/\D/g, "");
  return digits.length >= 10 ? `+${digits}` : null;
}

// Converte chamadas de template estruturado em texto legível quando o canal ativo do tenant for Evolution.
export function formatEvolutionTemplateText(
  templateName: string,
  variables: Record<string, string>,
): string {
  const bodyCandidate =
    variables["text"] ?? variables["body"] ?? variables["message"];
  if (bodyCandidate && bodyCandidate.trim().length > 0) {
    let rendered = bodyCandidate.trim();
    for (const [key, value] of Object.entries(variables)) {
      if (key === "text" || key === "body" || key === "message") continue;
      rendered = rendered.replaceAll(`{{${key}}}`, value);
    }
    return rendered;
  }

  const entries = Object.entries(variables)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${key}: ${value.trim()}`);

  if (entries.length === 0) {
    return templateName;
  }

  return `${templateName}\n${entries.join("\n")}`;
}

// Adaptador real da Evolution API v2 conectado à porta hexagonal WhatsAppGatewayPort.
// Resolve a instância isolada de cada tenant exclusivamente a partir de `tenant_whatsapp_channels`.
export class EvolutionWhatsAppAdapter implements WhatsAppGatewayPort {
  constructor(
    private readonly channelsRepository: TenantWhatsAppChannelsRepository,
    private readonly fetchFn: typeof fetch = (...args) =>
      globalThis.fetch(...args),
    private readonly envProvider: () => EvolutionEnvConfig = getEvolutionEnv,
  ) {}

  private requireEvolutionConfig(): {
    apiUrl: string;
    apiKey: string;
    webhookSecret?: string | undefined;
    backendPublicUrl?: string | undefined;
  } {
    const env = this.envProvider();
    if (!env.apiUrl || !env.apiKey) {
      throw new WhatsAppChannelUnavailableError(
        "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).",
      );
    }

    return {
      apiUrl: env.apiUrl,
      apiKey: env.apiKey,
      webhookSecret: env.webhookSecret,
      backendPublicUrl: env.backendPublicUrl,
    };
  }

  private async resolveTenantInstanceName(tenantId: string): Promise<string> {
    const channel = await this.channelsRepository.findByTenantAndProvider(
      tenantId,
      "EVOLUTION",
    );
    const instanceName =
      typeof channel?.credentials["instanceName"] === "string"
        ? channel.credentials["instanceName"].trim()
        : "";

    if (!instanceName) {
      throw new WhatsAppChannelUnavailableError(
        "Canal Evolution não configurado para este tenant.",
      );
    }

    return instanceName;
  }

  private async request(
    config: { apiUrl: string; apiKey: string },
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
  ): Promise<Response> {
    return this.fetchFn(`${config.apiUrl}${path}`, {
      method,
      headers: {
        apikey: config.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  public async sendText(params: SendTextParams): Promise<SendMessageResult> {
    const config = this.requireEvolutionConfig();
    const instanceName = await this.resolveTenantInstanceName(params.tenantId);
    const number = formatEvolutionPhoneNumber(params.to);

    const response = await this.request(
      config,
      `/message/sendText/${encodeURIComponent(instanceName)}`,
      "POST",
      {
        number,
        text: params.text,
        linkPreview: false,
      },
    );

    if (!response.ok) {
      throw new WhatsAppChannelUnavailableError(
        `Falha ao enviar mensagem de texto na Evolution API (HTTP ${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      key?: { id?: string };
      messageId?: string;
    };

    const externalMessageId = payload.key?.id ?? payload.messageId;
    return externalMessageId ? { externalMessageId } : {};
  }

  public async sendPresence(params: SendPresenceParams): Promise<void> {
    const config = this.requireEvolutionConfig();
    const instanceName = await this.resolveTenantInstanceName(params.tenantId);
    const number = formatEvolutionPhoneNumber(params.to);

    const response = await this.request(
      config,
      `/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      "POST",
      {
        number,
        presence: params.presence,
        delay: 5000,
      },
    );

    if (!response.ok) {
      throw new WhatsAppChannelUnavailableError(
        `Falha ao enviar presença na Evolution API (HTTP ${response.status}).`,
      );
    }
  }

  public async sendTemplate(
    params: SendTemplateParams,
  ): Promise<SendMessageResult> {
    const formattedText = formatEvolutionTemplateText(
      params.templateName,
      params.variables,
    );

    return this.sendText({
      tenantId: params.tenantId,
      to: params.to,
      text: formattedText,
      purpose: "CAMPAIGN",
    });
  }

  public async getChannelsStatus(tenantId: string): Promise<ChannelStatus[]> {
    const channels = await this.channelsRepository.listByTenant(tenantId);
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

  // Cria ou reutiliza a instância Evolution do tenant, configura o webhook autenticado e retorna o QR Code.
  public async connectInstance(
    tenantId: string,
    existingInstanceName?: string | null,
  ): Promise<EvolutionConnectInstanceResult> {
    const config = this.requireEvolutionConfig();
    const instanceName =
      existingInstanceName?.trim() || buildTenantEvolutionInstanceName(tenantId);

    let qrCodeBase64: string | null = null;
    let pairingCode: string | null = null;
    let status: TenantWhatsAppChannelStatus = "QRCODE_PENDING";
    let phoneNumber: string | null = null;

    // 1. Tenta criar a instância (WHATSAPP-BAILEYS + qrcode); se já existir, reutiliza.
    const createResponse = await this.request(
      config,
      "/instance/create",
      "POST",
      {
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      },
    );

    if (createResponse.ok) {
      const created = (await createResponse.json()) as {
        qrcode?: { base64?: string; pairingCode?: string };
        base64?: string;
        pairingCode?: string;
        instance?: { state?: string; owner?: string };
      };
      qrCodeBase64 = normalizeEvolutionQrDataUri(
        created.qrcode?.base64 ?? created.base64,
      );
      pairingCode =
        created.qrcode?.pairingCode ?? created.pairingCode ?? null;
      if (created.instance?.state) {
        status = mapEvolutionConnectionState(created.instance.state);
      }
      phoneNumber = extractOwnerPhone(created.instance?.owner);
    }

    // 2. Configura automaticamente o webhook da instância apontando para o backend autenticado por segredo.
    if (config.backendPublicUrl && config.webhookSecret) {
      const webhookUrl = `${config.backendPublicUrl}/v1/whatsapp/webhooks/evolution?secret=${encodeURIComponent(config.webhookSecret)}`;
      const webhookResponse = await this.request(
        config,
        `/webhook/set/${encodeURIComponent(instanceName)}`,
        "POST",
        {
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
          },
        },
      );

      if (!webhookResponse.ok) {
        throw new WhatsAppChannelUnavailableError(
          `Não foi possível configurar o webhook da instância Evolution (HTTP ${webhookResponse.status}).`,
        );
      }
    }

    // 3. Se a instância já existia ou ainda não retornou QR Code, consulta /instance/connect.
    if (status !== "CONNECTED" && !qrCodeBase64) {
      const connectResponse = await this.request(
        config,
        `/instance/connect/${encodeURIComponent(instanceName)}`,
        "GET",
      );

      if (!connectResponse.ok) {
        throw new WhatsAppChannelUnavailableError(
          `Não foi possível obter o QR Code da instância Evolution (HTTP ${connectResponse.status}).`,
        );
      }

      const connectPayload = (await connectResponse.json()) as {
        base64?: string;
        pairingCode?: string;
        qrcode?: { base64?: string; pairingCode?: string };
        instance?: { state?: string; owner?: string };
      };

      const mapped = mapEvolutionConnectionState(connectPayload.instance?.state);
      status = mapped === "CONNECTED" ? "CONNECTED" : "QRCODE_PENDING";
      qrCodeBase64 = normalizeEvolutionQrDataUri(
        connectPayload.base64 ?? connectPayload.qrcode?.base64,
      );
      pairingCode =
        connectPayload.pairingCode ??
        connectPayload.qrcode?.pairingCode ??
        pairingCode;
      phoneNumber =
        extractOwnerPhone(connectPayload.instance?.owner) ?? phoneNumber;
    }

    return {
      instanceName,
      qrCodeBase64,
      pairingCode,
      status,
      phoneNumber,
    };
  }

  public async getInstanceConnectionState(
    instanceName: string,
  ): Promise<EvolutionConnectionStateResult> {
    const config = this.requireEvolutionConfig();
    const response = await this.request(
      config,
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
      "GET",
    );

    if (response.status === 404) {
      return {
        instanceName,
        status: "DISCONNECTED",
        phoneNumber: null,
      };
    }

    if (!response.ok) {
      throw new WhatsAppChannelUnavailableError(
        `Falha ao consultar estado da instância Evolution (HTTP ${response.status}).`,
      );
    }

    const payload = (await response.json()) as {
      instance?: { state?: string; owner?: string };
      state?: string;
    };

    return {
      instanceName,
      status: mapEvolutionConnectionState(
        payload.instance?.state ?? payload.state,
      ),
      phoneNumber: extractOwnerPhone(payload.instance?.owner),
    };
  }

  public async disconnectInstance(instanceName: string): Promise<void> {
    const config = this.requireEvolutionConfig();
    const response = await this.request(
      config,
      `/instance/logout/${encodeURIComponent(instanceName)}`,
      "DELETE",
    );

    if (!response.ok && response.status !== 404) {
      throw new WhatsAppChannelUnavailableError(
        `Falha ao desconectar instância Evolution (HTTP ${response.status}).`,
      );
    }
  }
}
