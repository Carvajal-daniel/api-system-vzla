import { randomUUID } from "node:crypto";
import { isProduction } from "../../../../shared/config/env.js";
import {
  CompanyWhatsAppConnection,
  type EvolutionConnectionStatus,
} from "../../domain/entities/company-whatsapp-connection.entity.js";
import { WhatsAppChannelUnavailableError } from "../../domain/errors/whatsapp-errors.js";
import type {
  ConnectQrCodeResult,
  ConversationalStatusResult,
  SendConversationalTextInput,
  SendConversationalTextResult,
  WhatsAppConversationalPort,
} from "../../application/ports/whatsapp-conversational.port.js";

function buildMockQrSvgDataUri(instanceName: string): string {
  const shortLabel = instanceName.slice(0, 22);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">',
    '<rect width="240" height="240" rx="16" fill="#ffffff"/>',
    '<rect x="16" y="16" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="26" y="26" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="36" y="36" width="20" height="20" fill="#0f172a"/>',
    '<rect x="164" y="16" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="174" y="26" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="184" y="36" width="20" height="20" fill="#0f172a"/>',
    '<rect x="16" y="164" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="26" y="174" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="36" y="184" width="20" height="20" fill="#0f172a"/>',
    '<rect x="96" y="96" width="48" height="48" rx="8" fill="#25D366"/>',
    '<text x="120" y="125" text-anchor="middle" font-family="monospace" font-size="14" font-weight="bold" fill="#0f172a">MOCK</text>',
    `<text x="120" y="232" text-anchor="middle" font-family="monospace" font-size="9" fill="#475569">${shortLabel}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function normalizeQrDataUri(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  return `data:image/png;base64,${trimmed}`;
}

function mapEvolutionState(state?: string): EvolutionConnectionStatus {
  const normalized = (state ?? "").toLowerCase();
  if (normalized === "open" || normalized === "connected") return "CONNECTED";
  if (normalized === "connecting" || normalized === "qrcode") return "QRCODE_PENDING";
  return "DISCONNECTED";
}

function normalizeWhatsAppDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Adaptador da Evolution API v2 para atendimento conversacional 1-a-1.
// Cria/conecta instâncias dinamicamente por empresa (`cloudgo_<companyId>`) e opera
// em modo MOCK_READY em desenvolvimento quando WHATSAPP_EVOLUTION_URL/API_KEY não estiverem definidas.
export class EvolutionWhatsAppAdapter implements WhatsAppConversationalPort {
  private getConfig(): { baseUrl: string; apiKey: string } | null {
    const baseUrl = process.env.WHATSAPP_EVOLUTION_URL?.trim();
    const apiKey = process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();

    if (!baseUrl || !apiKey) {
      if (isProduction()) {
        throw new WhatsAppChannelUnavailableError(
          "Evolution API não configurada no ambiente de produção.",
        );
      }
      return null;
    }

    return {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey,
    };
  }

  public getMode(): "LIVE" | "MOCK_READY" {
    const baseUrl = process.env.WHATSAPP_EVOLUTION_URL?.trim();
    const apiKey = process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();
    return baseUrl && apiKey ? "LIVE" : "MOCK_READY";
  }

  private resolveInstanceName(companyId: string, instanceName?: string | null): string {
    return instanceName?.trim() || CompanyWhatsAppConnection.buildInstanceName(companyId);
  }

  private async request(
    config: { baseUrl: string; apiKey: string },
    path: string,
    method: "GET" | "POST" | "DELETE",
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${config.baseUrl}${path}`, {
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

  async getStatus(
    companyId: string,
    instanceName?: string | null,
  ): Promise<ConversationalStatusResult> {
    const resolvedInstance = this.resolveInstanceName(companyId, instanceName);
    const config = this.getConfig();

    if (!config) {
      return {
        instanceName: resolvedInstance,
        status: "DISCONNECTED",
        phoneNumber: null,
        mode: "MOCK_READY",
      };
    }

    const response = await this.request(
      config,
      `/instance/connectionState/${encodeURIComponent(resolvedInstance)}`,
      "GET",
    );

    if (response.status === 404) {
      return {
        instanceName: resolvedInstance,
        status: "DISCONNECTED",
        phoneNumber: null,
        mode: "LIVE",
      };
    }

    if (!response.ok) {
      throw new WhatsAppChannelUnavailableError(
        "Não foi possível consultar o status da instância Evolution API.",
      );
    }

    const payload = (await response.json()) as {
      instance?: { state?: string; owner?: string };
      state?: string;
    };

    const rawState = payload.instance?.state ?? payload.state;
    const owner = payload.instance?.owner?.replace(/@.*$/, "") ?? null;

    return {
      instanceName: resolvedInstance,
      status: mapEvolutionState(rawState),
      phoneNumber: owner,
      mode: "LIVE",
    };
  }

  async connectAndGetQrCode(
    companyId: string,
    instanceName?: string | null,
  ): Promise<ConnectQrCodeResult> {
    const resolvedInstance = this.resolveInstanceName(companyId, instanceName);
    const config = this.getConfig();

    if (!config) {
      return {
        instanceName: resolvedInstance,
        status: "QRCODE_PENDING",
        qrCodeBase64: buildMockQrSvgDataUri(resolvedInstance),
        pairingCode: "MOCK-1234",
        phoneNumber: null,
        mode: "MOCK_READY",
      };
    }

    // 1. Verifica se a instância já existe e está conectada
    const currentStatus = await this.getStatus(companyId, resolvedInstance);
    if (currentStatus.status === "CONNECTED") {
      return {
        instanceName: resolvedInstance,
        status: "CONNECTED",
        qrCodeBase64: null,
        pairingCode: null,
        phoneNumber: currentStatus.phoneNumber,
        mode: "LIVE",
      };
    }

    // 2. Tenta criar a instância dinamicamente; se já existir (403/409), segue para obter o QR Code
    const createResponse = await this.request(config, "/instance/create", "POST", {
      instanceName: resolvedInstance,
      qrcode: true,
      integration: "WHATSAPP-BAILEYS",
    });

    if (createResponse.ok) {
      const created = (await createResponse.json()) as {
        qrcode?: { base64?: string; pairingCode?: string };
        base64?: string;
      };
      const qr = normalizeQrDataUri(created.qrcode?.base64 ?? created.base64);
      if (qr) {
        return {
          instanceName: resolvedInstance,
          status: "QRCODE_PENDING",
          qrCodeBase64: qr,
          pairingCode: created.qrcode?.pairingCode ?? null,
          phoneNumber: null,
          mode: "LIVE",
        };
      }
    }

    // 3. Solicita o QR Code de pareamento da instância existente
    const connectResponse = await this.request(
      config,
      `/instance/connect/${encodeURIComponent(resolvedInstance)}`,
      "GET",
    );

    if (!connectResponse.ok) {
      throw new WhatsAppChannelUnavailableError(
        "Não foi possível iniciar o pareamento na Evolution API.",
      );
    }

    const connectPayload = (await connectResponse.json()) as {
      base64?: string;
      pairingCode?: string;
      qrcode?: { base64?: string; pairingCode?: string };
      instance?: { state?: string; owner?: string };
    };

    const status = mapEvolutionState(connectPayload.instance?.state);
    const qrCodeBase64 = normalizeQrDataUri(
      connectPayload.base64 ?? connectPayload.qrcode?.base64,
    );

    return {
      instanceName: resolvedInstance,
      status: status === "CONNECTED" ? "CONNECTED" : "QRCODE_PENDING",
      qrCodeBase64,
      pairingCode:
        connectPayload.pairingCode ?? connectPayload.qrcode?.pairingCode ?? null,
      phoneNumber: connectPayload.instance?.owner?.replace(/@.*$/, "") ?? null,
      mode: "LIVE",
    };
  }

  async disconnect(companyId: string, instanceName?: string | null): Promise<void> {
    const resolvedInstance = this.resolveInstanceName(companyId, instanceName);
    const config = this.getConfig();

    if (!config) {
      return;
    }

    const response = await this.request(
      config,
      `/instance/logout/${encodeURIComponent(resolvedInstance)}`,
      "DELETE",
    );

    if (!response.ok && response.status !== 404) {
      throw new WhatsAppChannelUnavailableError(
        "Não foi possível desconectar a instância na Evolution API.",
      );
    }
  }

  async sendTextMessage(
    input: SendConversationalTextInput,
  ): Promise<SendConversationalTextResult> {
    const resolvedInstance = this.resolveInstanceName(
      input.companyId,
      input.instanceName,
    );
    const config = this.getConfig();

    if (!config) {
      return {
        messageId: `mock_${randomUUID()}`,
        provider: "MOCK_READY",
      };
    }

    const response = await this.request(
      config,
      `/message/sendText/${encodeURIComponent(resolvedInstance)}`,
      "POST",
      {
        number: normalizeWhatsAppDigits(input.phone),
        text: input.text,
        linkPreview: false,
      },
    );

    if (!response.ok) {
      throw new WhatsAppChannelUnavailableError(
        "Falha ao enviar mensagem conversacional pela Evolution API.",
      );
    }

    const payload = (await response.json()) as { key?: { id?: string } };
    return {
      messageId: payload.key?.id ?? randomUUID(),
      provider: "EVOLUTION",
    };
  }
}
