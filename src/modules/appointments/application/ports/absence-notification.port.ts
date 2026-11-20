import type { AffectedAppointmentSummaryDTO } from "../dtos/schedule-block.dtos.js";

export interface AbsenceNotificationPayload {
  companyId: string;
  blockId: string;
  collaboratorId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  affectedAppointments: AffectedAppointmentSummaryDTO[];
}

/**
 * Porta desacoplada para notificar clientes impactados por bloqueios/ausências
 * (adaptador de WhatsApp será conectado na Etapa 5 sem alterar regras de negócio).
 */
export interface AbsenceNotificationPort {
  notifyAffectedAppointments(payload: AbsenceNotificationPayload): Promise<void>;
}
