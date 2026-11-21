import {
  AppointmentCompletionTooEarlyError,
  AppointmentNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import {
  type AppointmentOutputDTO,
  type UpdateAppointmentStatusInputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export class UpdateAppointmentStatusUseCase {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async execute(
    input: UpdateAppointmentStatusInputDTO,
  ): Promise<AppointmentOutputDTO> {
    const { actor } = input;

    const appointment = await this.appointmentsRepository.findById(
      actor.companyId,
      input.appointmentId,
    );

    if (!appointment) {
      throw new AppointmentNotFoundError();
    }

    if (
      actor.role === "COLLABORATOR" &&
      appointment.collaboratorId !== actor.collaboratorId
    ) {
      throw new UnauthorizedSchedulingActionError();
    }

    const { startsAt, status, collaboratorId } = appointment;
    if (input.status === "COMPLETED" && startsAt > (input.now ?? new Date())) {
      throw new AppointmentCompletionTooEarlyError();
    }

    appointment.transitionStatus(input.status, input.cancellationReason ?? null);
    await this.appointmentsRepository.save(appointment, { startsAt, status, collaboratorId });

    return toAppointmentOutputDTO(appointment);
  }
}
