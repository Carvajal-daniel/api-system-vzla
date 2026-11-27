import { db } from "../../../../shared/database/database.js";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { recordSaasTelemetry } from "../../../billing/infra/database/repositories/drizzle-saas-telemetry.repository.js";
import { DrizzleClientsRepository } from "../../../clients/infra/database/repositories/drizzle-clients.repository.js";
import type { WhatsAppGatewayPort } from "../../../whatsapp/application/ports/whatsapp-gateway.port.js";
import { WhatsAppMessage } from "../../../whatsapp/domain/entities/whatsapp-message.entity.js";
import { WhatsAppGatewayRouter as HybridWhatsAppGatewayRouter } from "../../../whatsapp/infra/adapters/whatsapp/whatsapp-gateway.router.js";
import { DrizzleTenantWhatsAppChannelsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-tenant-whatsapp-channels.repository.js";
import { DrizzleWhatsAppConversationsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-whatsapp-conversations.repository.js";
import { DrizzleWhatsAppMessagesRepository } from "../../../whatsapp/infra/database/repositories/drizzle-whatsapp-messages.repository.js";
import type {
  OperationsNotificationPort,
  OperationsWhatsAppDispatchInput,
  OperationsWhatsAppDispatchResult,
} from "../../application/ports/operations-notification.port.js";

// Adaptador operacional de WhatsApp (camada L0): envia mensagens proativas sem gastar tokens L2,
// registra o histórico na Inbox da empresa e incrementa telemetria `aiTurnsL0` de forma isolada.
export class WhatsAppOperationsNotificationAdapter
  implements OperationsNotificationPort
{
  private readonly gateway: WhatsAppGatewayPort;
  private readonly conversationsRepository: DrizzleWhatsAppConversationsRepository;
  private readonly messagesRepository: DrizzleWhatsAppMessagesRepository;
  private readonly clientsRepository: DrizzleClientsRepository;

  constructor(gateway?: WhatsAppGatewayPort) {
    this.gateway =
      gateway ??
      new HybridWhatsAppGatewayRouter(
        new DrizzleTenantWhatsAppChannelsRepository(),
      );
    this.conversationsRepository = new DrizzleWhatsAppConversationsRepository();
    this.messagesRepository = new DrizzleWhatsAppMessagesRepository();
    this.clientsRepository = new DrizzleClientsRepository();
  }

  async sendOperationalMessage(
    input: OperationsWhatsAppDispatchInput,
  ): Promise<OperationsWhatsAppDispatchResult> {
    const now = input.now ?? new Date();
    let normalizedPhone: string;
    try {
      normalizedPhone = Phone.create(input.phone).value;
    } catch {
      return {
        delivered: false,
        provider: "INVALID_PHONE",
        externalMessageId: null,
        error: "Invalid phone number",
      };
    }

    let delivered = false;
    let externalMessageId: string | null = null;
    let deliveryError: string | undefined;

    try {
      const dispatch = await this.gateway.sendText({
        tenantId: input.companyId,
        to: normalizedPhone,
        text: input.text,
        purpose: "RECEPTION",
      });
      delivered = true;
      externalMessageId = dispatch.externalMessageId ?? null;
    } catch (error) {
      deliveryError =
        error instanceof Error ? error.message : "Canal WhatsApp indisponível";
    }

    try {
      const clientId =
        input.clientId ??
        (await this.clientsRepository.findByPhone(input.companyId, normalizedPhone))
          ?.id ??
        null;

      const conversation = await this.conversationsRepository.upsertOutbound({
        companyId: input.companyId,
        phone: normalizedPhone,
        clientId,
        contactName: input.contactName,
        sentAt: now,
        status: "WAITING_CLIENT",
      });

      await this.messagesRepository.createIdempotent(
        WhatsAppMessage.create({
          companyId: input.companyId,
          conversationId: conversation.id,
          externalMessageId,
          direction: "OUTBOUND",
          senderType: "AI_AGENT",
          content: input.text,
          metadata: {
            kind: input.kind,
            delivered,
            ...(deliveryError ? { deliveryError } : {}),
            ...(input.metadata ?? {}),
          },
          sentAt: now,
        }),
      );
    } catch {
      // Isola falhas de registro na Inbox para não abortar o fluxo operacional principal.
    }

    if (input.recordL0Telemetry) {
      try {
        await db.transaction(async (tx) => {
          await recordSaasTelemetry(tx, input.companyId, now, {
            aiTurnsL0: 1,
            tokensInput: 0,
            tokensOutput: 0,
          });
        });
      } catch {
        // Telemetria L0 é melhor esforço e não deve falhar a operação do balcão.
      }
    }

    return {
      delivered,
      provider: delivered ? "WHATSAPP_GATEWAY" : "SKIPPED",
      externalMessageId,
      ...(deliveryError ? { error: deliveryError } : {}),
    };
  }
}
