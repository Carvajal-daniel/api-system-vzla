import type {
  AbsenceNotificationPayload,
  AbsenceNotificationPort,
} from "../../../appointments/application/ports/absence-notification.port.js";
import type { ClientsRepository } from "../../../clients/domain/repositories/clients.repository.js";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { WhatsAppMessage } from "../../domain/entities/whatsapp-message.entity.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { ConversationalDispatchPort } from "../../application/use-cases/process-inbound-whatsapp-message.use-case.js";

function formatBrazilianDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// Adaptador real de notificações de ausência/bloqueio e desativação de profissional.
// Envia aviso individual 1-a-1 pelo WhatsAppGatewayRouter e registra a mensagem na Inbox.
export class WhatsAppAbsenceNotificationAdapter
  implements AbsenceNotificationPort
{
  constructor(
    private readonly gatewayRouter: ConversationalDispatchPort,
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly clientsRepository: ClientsRepository,
  ) {}

  async notifyAffectedAppointments(
    payload: AbsenceNotificationPayload,
  ): Promise<void> {
    if (payload.affectedAppointments.length === 0) {
      return;
    }

    const reasonText = payload.reason?.trim()
      ? ` Motivo informado: ${payload.reason.trim()}.`
      : "";

    for (const appointment of payload.affectedAppointments) {
      try {
        const normalizedPhone = Phone.create(appointment.clientPhone).value;
        const formattedDate = formatBrazilianDateTime(appointment.startsAt);
        const text = `Olá, ${appointment.clientName}! Infelizmente houve um imprevisto na agenda e precisaremos reagendar o seu horário do dia ${formattedDate}.${reasonText} Responda esta mensagem com o melhor dia e horário para você que já ajustamos na hora.`;

        let referenceId: string | null = null;
        let deliveryProvider = "SKIPPED";
        let deliveryError: string | null = null;

        try {
          const dispatch = await this.gatewayRouter.send({
            purpose: "CONVERSATIONAL_REPLY",
            companyId: payload.companyId,
            phone: normalizedPhone,
            text,
          });
          referenceId = dispatch.referenceId;
          deliveryProvider = dispatch.provider;
        } catch (error) {
          deliveryError =
            error instanceof Error ? error.message : "Canal indisponível";
        }

        const client = await this.clientsRepository.findByPhone(
          payload.companyId,
          normalizedPhone,
        );
        const sentAt = new Date();
        const conversation = await this.conversationsRepository.upsertOutbound({
          companyId: payload.companyId,
          phone: normalizedPhone,
          clientId: client?.id ?? null,
          contactName: appointment.clientName,
          sentAt,
          status: "WAITING_CLIENT",
        });

        await this.messagesRepository.createIdempotent(
          WhatsAppMessage.create({
            companyId: payload.companyId,
            conversationId: conversation.id,
            externalMessageId: referenceId,
            direction: "OUTBOUND",
            senderType: "AI_AGENT",
            content: text,
            metadata: {
              kind: "ABSENCE_NOTIFICATION",
              blockId: payload.blockId,
              appointmentId: appointment.id,
              deliveryProvider,
              ...(deliveryError ? { deliveryError } : {}),
            },
            sentAt,
          }),
        );
      } catch {
        // Isola falhas individuais por cliente para nunca interromper o bloqueio ou a desativação.
      }
    }
  }
}
