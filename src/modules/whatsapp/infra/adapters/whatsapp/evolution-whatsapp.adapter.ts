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

export interface EvolutionAdapterLogger {
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

// Erro de configuração ausente para a integração com a Evolution API.
export class EvolutionApiConfigError extends WhatsAppChannelUnavailableError {
  constructor(
    message = "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).",
  ) {
    super(message);
    this.name = "EvolutionApiConfigError";
  }
}

// Erro de rede/timeout quando o container da Evolution API está inacessível.
export class EvolutionApiUnreachableError extends WhatsAppChannelUnavailableError {
  constructor(
    message = "Servidor Evolution API inacessível. Verifique se o container Docker está rodando.",
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "EvolutionApiUnreachableError";
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

// Erro HTTP retornado pela Evolution API v2 (ex.: 401, 500).
export class EvolutionApiHttpError extends WhatsAppChannelUnavailableError {
  public readonly statusCode: number;
  public readonly detail?: string | undefined;

  constructor(statusCode: number, message: string, detail?: string) {
    super(message);
    this.name = "EvolutionApiHttpError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

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

interface EvolutionQrPayload {
  qrcode?: { base64?: string; code?: string; pairingCode?: string };
  base64?: string;
  code?: string;
  pairingCode?: string;
  instance?: { state?: string; owner?: string };
}

// Identifica erros de rede/timeout gerados pelo fetch (ECONNREFUSED, AbortError, etc.).
export function isEvolutionNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name;
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }

  const message = error.message.toLowerCase();
  if (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("etimedout") ||
    message.includes("econnreset") ||
    message.includes("network")
  ) {
    return true;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const code = (cause as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      [
        "ECONNREFUSED",
        "ENOTFOUND",
        "ETIMEDOUT",
        "ECONNRESET",
        "EHOSTUNREACH",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_SOCKET",
      ].includes(code)
    ) {
      return true;
    }
  }

  return false;
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

// Extrai o QR Code cobrindo todos os formatos retornados pela Evolution API v2
// (qrcode.base64, base64 ou code/qrcode.code).
export function extractEvolutionQrCode(
  payload: EvolutionQrPayload | undefined | null,
): string | null {
  if (!payload) return null;

  const base64Candidate = payload.qrcode?.base64 ?? payload.base64;
  if (base64Candidate && base64Candidate.trim().length > 0) {
    return normalizeEvolutionQrDataUri(base64Candidate);
  }

  const codeCandidate = payload.qrcode?.code ?? payload.code;
  if (!codeCandidate) return null;
  const trimmed = codeCandidate.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  // Se o campo `code` já vier como imagem PNG/JPEG em base64, normaliza para data URI.
  if (trimmed.startsWith("iVBOR") || trimmed.startsWith("/9j/")) {
    return `data:image/png;base64,${trimmed}`;
  }
  return trimmed;
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
      throw new EvolutionApiConfigError(
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
    try {
      return await this.fetchFn(`${config.apiUrl}${path}`, {
        method,
        headers: {
          apikey: config.apiKey,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
        body: body === undefined ? null : JSON.stringify(body),
      });
    } catch (error) {
      if (isEvolutionNetworkError(error)) {
        throw new EvolutionApiUnreachableError(
          "Servidor Evolution API inacessível. Verifique se o container Docker está rodando.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async safeReadResponseText(response: Response): Promise<string> {
    try {
      return (await response.text()).slice(0, 500);
    } catch {
      return "";
    }
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
    logger?: EvolutionAdapterLogger,
  ): Promise<EvolutionConnectInstanceResult> {
    const config = this.requireEvolutionConfig();
    const instanceName =
      existingInstanceName?.trim() || buildTenantEvolutionInstanceName(tenantId);

    let qrCodeBase64: string | null = null;
    let pairingCode: string | null = null;
    let status: TenantWhatsAppChannelStatus = "QRCODE_PENDING";
    let phoneNumber: string | null = null;

    // 1. Tenta criar a instância (WHATSAPP-BAILEYS + qrcode); se já existir (400/403/409), segue para /instance/connect.
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
      const created = (await createResponse.json()) as EvolutionQrPayload;
      qrCodeBase64 = extractEvolutionQrCode(created);
      pairingCode =
        created.qrcode?.pairingCode ?? created.pairingCode ?? null;
      if (created.instance?.state) {
        status = mapEvolutionConnectionState(created.instance.state);
      }
      phoneNumber = extractOwnerPhone(created.instance?.owner);
    } else if (
      createResponse.status === 400 ||
      createResponse.status === 403 ||
      createResponse.status === 409
    ) {
      // Na Evolution API v2, instância já existente retorna 400, 403 ou 409; reutilizamos sem interromper o fluxo.
      const detail = await this.safeReadResponseText(createResponse);
      logger?.warn(
        { tenantId, instanceName, status: createResponse.status, detail },
        "Evolution instance already exists or rejected creation; falling back to /instance/connect",
      );
    } else {
      const detail = await this.safeReadResponseText(createResponse);
      throw new EvolutionApiHttpError(
        createResponse.status,
        `Falha ao criar instância na Evolution API (HTTP ${createResponse.status}).`,
        detail,
      );
    }

    // 2. Configura automaticamente o webhook da instância no formato Evolution API v2.
    // Falhas aqui são apenas logadas para não derrubar a geração do QR Code.
    if (config.backendPublicUrl && config.webhookSecret) {
      const webhookUrl = `${config.backendPublicUrl}/v1/whatsapp/webhooks/evolution?secret=${encodeURIComponent(config.webhookSecret)}`;
      try {
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
          const detail = await this.safeReadResponseText(webhookResponse);
          logger?.warn(
            {
              tenantId,
              instanceName,
              status: webhookResponse.status,
              detail,
            },
            "Failed to configure Evolution webhook; proceeding with QR Code generation",
          );
        }
      } catch (error) {
        logger?.warn(
          { tenantId, instanceName, err: error },
          "Unexpected error while configuring Evolution webhook; proceeding with QR Code generation",
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
        const detail = await this.safeReadResponseText(connectResponse);
        throw new EvolutionApiHttpError(
          connectResponse.status,
          `Não foi possível obter o QR Code da instância Evolution (HTTP ${connectResponse.status}).`,
          detail,
        );
      }

      const connectPayload =
        (await connectResponse.json()) as EvolutionQrPayload;

      const mapped = mapEvolutionConnectionState(connectPayload.instance?.state);
      status = mapped === "CONNECTED" ? "CONNECTED" : "QRCODE_PENDING";
      qrCodeBase64 = extractEvolutionQrCode(connectPayload);
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
      instance?: {
        state?: string;
        connectionStatus?: string;
        owner?: string;
        ownerJid?: string;
      };
      state?: string;
      connectionStatus?: string;
    };

    return {
      instanceName,
      status: mapEvolutionConnectionState(
        payload.instance?.state ??
          payload.instance?.connectionStatus ??
          payload.state ??
          payload.connectionStatus,
      ),
      phoneNumber: extractOwnerPhone(
        payload.instance?.owner ?? payload.instance?.ownerJid,
      ),
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
