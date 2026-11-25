import { randomUUID } from "node:crypto";
import type {
  ChannelStatus,
  SendMessageResult,
  SendPresenceParams,
  SendTemplateParams,
  SendTextParams,
  WhatsAppGatewayPort,
} from "../../../application/ports/whatsapp-gateway.port.js";

export interface StructuredLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn?(obj: Record<string, unknown>, msg?: string): void;
}

const defaultLogger: StructuredLogger = {
  info(obj, msg) {
    process.stdout.write(
      `${JSON.stringify({ level: "info", msg: msg ?? "whatsapp_mock", ...obj })}\n`,
    );
  },
};

// Adaptador simulado de WhatsApp para desenvolvimento, testes e fallback seguro
// quando o tenant ainda não possui provedores externos (Evolution/Meta) conectados.
export class MockWhatsAppAdapter implements WhatsAppGatewayPort {
  constructor(private readonly logger: StructuredLogger = defaultLogger) {}

  public async sendText(params: SendTextParams): Promise<SendMessageResult> {
    const externalMessageId = `mock_wa_txt_${randomUUID()}`;
    this.logger.info(
      {
        adapter: "MockWhatsAppAdapter",
        action: "sendText",
        tenantId: params.tenantId,
        to: params.to,
        purpose: params.purpose ?? "RECEPTION",
        textLength: params.text.length,
        externalMessageId,
      },
      "Simulated WhatsApp text message dispatched",
    );

    return { externalMessageId };
  }

  public async sendTemplate(
    params: SendTemplateParams,
  ): Promise<SendMessageResult> {
    const externalMessageId = `mock_wa_tpl_${randomUUID()}`;
    this.logger.info(
      {
        adapter: "MockWhatsAppAdapter",
        action: "sendTemplate",
        tenantId: params.tenantId,
        to: params.to,
        templateName: params.templateName,
        variableKeys: Object.keys(params.variables),
        externalMessageId,
      },
      "Simulated WhatsApp template message dispatched",
    );

    return { externalMessageId };
  }

  public async sendPresence(params: SendPresenceParams): Promise<void> {
    this.logger.info(
      {
        adapter: "MockWhatsAppAdapter",
        action: "sendPresence",
        tenantId: params.tenantId,
        to: params.to,
        presence: params.presence,
      },
      "Simulated WhatsApp presence state dispatched",
    );
  }

  public async getChannelsStatus(tenantId: string): Promise<ChannelStatus[]> {
    return [
      {
        id: `mock-${tenantId}`,
        provider: "MOCK",
        purpose: "ALL",
        phoneNumber: null,
        status: "CONNECTED",
        credentials: {},
        updatedAt: new Date().toISOString(),
      },
    ];
  }
}
