import { AppointmentNotFoundError, UnauthorizedSchedulingActionError } from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import {
  type AppointmentOutputDTO,
  type ListAppointmentsInputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export class ListAppointmentsUseCase {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async get(actor: ListAppointmentsInputDTO["actor"], id: string) {
    const appointment = await this.appointmentsRepository.findById(actor.companyId, id);
    if (!appointment || (actor.role === "COLLABORATOR" && appointment.collaboratorId !== actor.collaboratorId)) {
      throw new AppointmentNotFoundError();
    }
    return toAppointmentOutputDTO(appointment);
  }

  async execute(
    input: ListAppointmentsInputDTO,
  ): Promise<AppointmentOutputDTO[]> {
    const { actor } = input;
    let collaboratorId = input.collaboratorId;

    if (actor.role === "COLLABORATOR") {
      if (
        collaboratorId !== undefined &&
        collaboratorId !== actor.collaboratorId
      ) {
        throw new UnauthorizedSchedulingActionError();
      }
      collaboratorId = actor.collaboratorId;
    }

    const appointments = await this.appointmentsRepository.list({
      companyId: actor.companyId,
      collaboratorId,
      from: input.from,
      to: input.to,
      status: input.status,
    });

    return appointments.map(toAppointmentOutputDTO);
  }
}
