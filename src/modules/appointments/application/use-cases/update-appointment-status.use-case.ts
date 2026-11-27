import {
  AppointmentCompletionTooEarlyError,
  AppointmentNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import { AppointmentPolicyService } from "../../domain/services/appointment-policy.service.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import {
  type AppointmentOutputDTO,
  type UpdateAppointmentStatusInputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export interface OnAppointmentCanceledHook {
  notifyNextCompatibleForCanceledAppointment(input: {
    companyId: string;
    collaboratorId: string;
    startsAt: Date;
    now?: Date | undefined;
  }): Promise<unknown>;
}

export class UpdateAppointmentStatusUseCase {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
    private readonly waitlistHook?: OnAppointmentCanceledHook,
  ) {}

  async execute(
    input: UpdateAppointmentStatusInputDTO,
  ): Promise<AppointmentOutputDTO> {
    const { actor, actorSource } = input;

    const appointment = await this.appointmentsRepository.findById(
      actor.companyId,
      input.appointmentId,
    );

    if (!appointment) {
      throw new AppointmentNotFoundError();
    }

    // Permite transição por OWNER, pela IA do WhatsApp ou pelo próprio colaborador atribuído.
    if (
      actorSource !== "WHATSAPP_AI" &&
      actor.role === "COLLABORATOR" &&
      appointment.collaboratorId !== actor.collaboratorId
    ) {
      throw new UnauthorizedSchedulingActionError();
    }

    const { startsAt, status, collaboratorId } = appointment;
    const now = input.now ?? new Date();
    const ai = actorSource === "WHATSAPP_AI";
    if (ai) AppointmentPolicyService.assertAiCanChange(startsAt, now);
    if (input.status === "COMPLETED" && appointment.endsAt > now) {
      throw new AppointmentCompletionTooEarlyError();
    }

    appointment.transitionStatus(input.status, input.cancellationReason ?? null);
    await this.appointmentsRepository.save(appointment, { startsAt, status, collaboratorId }, ai ? now : undefined);

    // Gatilho automático da Fila de Espera Inteligente ao liberar um horário futuro por cancelamento.
    if (input.status === "CANCELED" && this.waitlistHook && startsAt > now) {
      try {
        await this.waitlistHook.notifyNextCompatibleForCanceledAppointment({
          companyId: actor.companyId,
          collaboratorId,
          startsAt,
          now,
        });
      } catch {
        // Isola falhas na fila de espera para nunca reverter o cancelamento já confirmado.
      }
    }

    return toAppointmentOutputDTO(appointment);
  }
}
