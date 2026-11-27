import { AppointmentNotFoundError, UnauthorizedSchedulingActionError } from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import {
  type AppointmentAuditLogOutputDTO,
  type AppointmentOutputDTO,
  type ListAppointmentsInputDTO,
  toAppointmentAuditLogOutputDTO,
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

  async listAuditLogs(
    actor: ListAppointmentsInputDTO["actor"],
    appointmentId: string,
  ): Promise<AppointmentAuditLogOutputDTO[]> {
    const appointment = await this.appointmentsRepository.findById(
      actor.companyId,
      appointmentId,
    );
    if (
      !appointment ||
      (actor.role === "COLLABORATOR" &&
        appointment.collaboratorId !== actor.collaboratorId)
    ) {
      throw new AppointmentNotFoundError();
    }

    const logs = await this.appointmentsRepository.listAuditLogs(
      actor.companyId,
      appointmentId,
    );
    return logs.map(toAppointmentAuditLogOutputDTO);
  }

  async execute(
    input: ListAppointmentsInputDTO,
  ): Promise<Array<AppointmentOutputDTO & { awaitingClosure: boolean }>> {
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

    const now = new Date();
    return appointments.map((appointment) => ({
      ...toAppointmentOutputDTO(appointment),
      awaitingClosure: appointment.status === "CONFIRMED" && appointment.endsAt <= now,
    }));
  }
}
