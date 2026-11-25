import type { AbsenceNotificationPort } from "../../appointments/application/ports/absence-notification.port.js";
import { toAffectedAppointmentSummaryDTO } from "../../appointments/application/dtos/schedule-block.dtos.js";
import type { AppointmentsRepository } from "../../appointments/domain/repositories/appointments.repository.js";
import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export interface DeactivateCollaboratorInput {
  collaboratorId: string;
  companyId: string;
  reason?: string | null | undefined;
  queueAiReschedule: boolean;
}

export class DeactivateCollaboratorUseCase {
  constructor(
    private readonly collaboratorsRepository: CollaboratorsRepository,
    private readonly appointmentsRepository?: AppointmentsRepository,
    private readonly absenceNotificationPort?: AbsenceNotificationPort,
  ) {}

  async execute(input: DeactivateCollaboratorInput): Promise<{ message: string; queuedCount: number }> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    const now = new Date();
    const affectedAppointments =
      input.queueAiReschedule && this.appointmentsRepository
        ? (
            await this.appointmentsRepository.list({
              companyId: input.companyId,
              collaboratorId: input.collaboratorId,
              from: now,
            })
          ).filter(
            (appointment) =>
              appointment.status === "PENDING" ||
              appointment.status === "CONFIRMED",
          )
        : [];

    const { queuedCount } = await this.collaboratorsRepository.deactivateAndQueueReschedule(
      input.collaboratorId,
      input.companyId,
      input.reason,
      input.queueAiReschedule,
    );

    // Notifica automaticamente os clientes afetados via WhatsApp quando o reagendamento inteligente está ativado.
    if (
      input.queueAiReschedule &&
      this.absenceNotificationPort &&
      affectedAppointments.length > 0
    ) {
      const lastEnd = affectedAppointments.reduce(
        (max, appt) => (appt.endsAt > max ? appt.endsAt : max),
        now,
      );
      await this.absenceNotificationPort.notifyAffectedAppointments({
        companyId: input.companyId,
        blockId: `deactivation:${input.collaboratorId}`,
        collaboratorId: input.collaboratorId,
        startsAt: now.toISOString(),
        endsAt: lastEnd.toISOString(),
        reason: input.reason ?? "Profissional indisponível na agenda",
        affectedAppointments: affectedAppointments.map(
          toAffectedAppointmentSummaryDTO,
        ),
      });
    }

    return {
      message: "Colaborador desativado com sucesso.",
      queuedCount,
    };
  }
}
