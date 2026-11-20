import type {
  AbsenceNotificationPayload,
  AbsenceNotificationPort,
} from "../../application/ports/absence-notification.port.js";

/**
 * Adaptador provisório da Etapa 3. Na Etapa 5 (WhatsApp + IA) será substituído
 * por um adaptador de mensageria sem alterar casos de uso ou domínio.
 */
export class NoopAbsenceNotificationAdapter implements AbsenceNotificationPort {
  async notifyAffectedAppointments(
    _payload: AbsenceNotificationPayload,
  ): Promise<void> {
    // Intencionalmente no-op nesta etapa; a resposta HTTP já devolve affectedAppointments.
  }
}
