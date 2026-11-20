import type { Appointment } from "../entities/appointment.entity.js";
import type { AppointmentStatusValue } from "../value-objects/appointment-status.vo.js";

export interface ListAppointmentsFilter {
  companyId: string;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  status?: AppointmentStatusValue | undefined;
}

export interface AppointmentsRepository {
  /**
   * Cria o agendamento de forma atômica sob lock exclusivo por (companyId, collaboratorId),
   * rejeitando com AppointmentTimeConflictError caso exista qualquer agendamento ativo sobreposto.
   */
  createWithLock(appointment: Appointment): Promise<void>;

  /**
   * Reprograma o agendamento de forma atômica sob lock exclusivo por (companyId, collaboratorId),
   * ignorando o próprio `appointment.id` na verificação de sobreposição.
   */
  rescheduleWithLock(appointment: Appointment): Promise<void>;

  save(appointment: Appointment): Promise<void>;

  findById(companyId: string, appointmentId: string): Promise<Appointment | null>;

  list(filter: ListAppointmentsFilter): Promise<Appointment[]>;

  /**
   * Retorna agendamentos ativos (PENDING ou CONFIRMED) que se sobrepõem a [rangeStart, rangeEnd).
   * Se collaboratorId for null/undefined, busca em toda a empresa (bloqueio global).
   */
  findActiveOverlapping(
    companyId: string,
    rangeStart: Date,
    rangeEnd: Date,
    collaboratorId?: string | null,
  ): Promise<Appointment[]>;
}
