import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { getLocalDateTimeParts } from "../../../appointments/domain/services/timezone-utils.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import { WhatsAppMessage } from "../../domain/entities/whatsapp-message.entity.js";
import type {
  AppointmentRemindersRepository,
  PendingReminderAppointment,
  ReminderWindowType,
} from "../../domain/repositories/appointment-reminders.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.js";

export interface ProcessAppointmentRemindersInput {
  tenantId?: string | undefined;
  now?: Date | undefined;
  windowTypes?: ReminderWindowType[] | undefined;
}

export interface ProcessAppointmentRemindersOutput {
  sentCount: number;
  skippedQuotaCount: number;
  skippedAlreadySentCount: number;
  failedCount: number;
}

function buildReminderMessage(
  appt: PendingReminderAppointment,
  windowType: ReminderWindowType,
): string {
  const local = getLocalDateTimeParts(appt.startsAt, appt.companyTimezone);
  const hh = String(local.hour).padStart(2, "0");
  const mm = String(local.minute).padStart(2, "0");
  const whenLabel = windowType === "24H" ? "amanhã" : "em breve (daqui a ~2h)";

  return [
    `Olá, ${appt.clientName}! 👋`,
    `Lembrando do seu agendamento na *${appt.companyName}* ${whenLabel}:`,
    `• Serviço: *${appt.serviceName}*`,
    `• Profissional: *${appt.collaboratorName}*`,
    `• Data/Hora: *${local.dateString} às ${hh}:${mm}*`,
    "",
    "Se precisar confirmar, reagendar ou cancelar, é só responder esta mensagem por aqui!",
  ].join("\n");
}

// Dispara lembretes idempotentes (24h e 2h) respeitando a cota mensal de disparos do tenant
// e salva o histórico na conversa para que o GeminiBookingAgentAdapter consiga reagendar na resposta.
export class ProcessAppointmentRemindersUseCase {
  constructor(
    private readonly remindersRepository: AppointmentRemindersRepository,
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly whatsappGateway: WhatsAppGatewayPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
  ) {}

  public async execute(
    input: ProcessAppointmentRemindersInput = {},
  ): Promise<ProcessAppointmentRemindersOutput> {
    const now = input.now ?? new Date();
    const windows: ReminderWindowType[] = input.windowTypes ?? ["24H", "2H"];

    let sentCount = 0;
    let skippedQuotaCount = 0;
    let skippedAlreadySentCount = 0;
    let failedCount = 0;

    for (const windowType of windows) {
      const pending = await this.remindersRepository.findPendingReminders({
        tenantId: input.tenantId,
        now,
        windowType,
      });

      for (const appt of pending) {
        const quota = await this.planQuotaGuard.checkCanSendOutbound(
          appt.companyId,
          now,
        );
        if (!quota.allowed) {
          skippedQuotaCount += 1;
          continue;
        }

        let normalizedPhone: string;
        try {
          normalizedPhone = Phone.create(appt.clientPhone).value;
        } catch {
          failedCount += 1;
          continue;
        }

        const claimed = await this.remindersRepository.markReminderSent({
          companyId: appt.companyId,
          appointmentId: appt.appointmentId,
          windowType,
          sentAt: now,
        });
        if (!claimed) {
          skippedAlreadySentCount += 1;
          continue;
        }

        const text = buildReminderMessage(appt, windowType);
        try {
          const dispatch = await this.whatsappGateway.sendText({
            tenantId: appt.companyId,
            to: normalizedPhone,
            text,
            purpose: "RECEPTION",
          });

          const conversation = await this.conversationsRepository.upsertOutbound({
            companyId: appt.companyId,
            phone: normalizedPhone,
            clientId: null,
            contactName: appt.clientName,
            sentAt: now,
            status: "WAITING_CLIENT",
          });

          const outboundMessage = WhatsAppMessage.create({
            companyId: appt.companyId,
            conversationId: conversation.id,
            externalMessageId: dispatch.externalMessageId ?? null,
            direction: "OUTBOUND",
            senderType: "AI_AGENT",
            content: text,
            metadata: {
              type: "APPOINTMENT_REMINDER",
              windowType,
              appointmentId: appt.appointmentId,
            },
            sentAt: now,
          });

          await this.messagesRepository.createIdempotent(outboundMessage);

          await this.planQuotaGuard.recordAiUsage({
            tenantId: appt.companyId,
            feature: "RETENTION",
            model: "whatsapp-reminder",
            promptTokens: 0,
            completionTokens: 0,
            incrementOutbound: true,
            metadata: {
              appointmentId: appt.appointmentId,
              windowType,
            },
            now,
          });

          sentCount += 1;
        } catch {
          failedCount += 1;
        }
      }
    }

    return {
      sentCount,
      skippedQuotaCount,
      skippedAlreadySentCount,
      failedCount,
    };
  }
}
