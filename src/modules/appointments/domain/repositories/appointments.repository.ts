import type { Appointment } from "../entities/appointment.entity.js";
import type { AppointmentStatusValue } from "../value-objects/appointment-status.vo.js";

export interface ListAppointmentsFilter {
  companyId: string;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  status?: AppointmentStatusValue | undefined;
}

export interface BookingClientData {
  [field: string]: string | undefined;
  birthDate?: string | undefined;
  document?: string | undefined;
  email?: string | undefined;
  gender?: "FEMALE" | "MALE" | "OTHER" | undefined;
  source?: string | undefined;
}

export interface PublicBookingDetails {
  clientData: BookingClientData;
  cancellationDigest: string;
}

export interface AppointmentAuditLogRecord {
  id: string;
  companyId: string;
  appointmentId: string;
  action: string;
  previousStatus: AppointmentStatusValue;
  newStatus: AppointmentStatusValue;
  reason: string;
  authorizedById: string;
  authorizedByName: string;
  authorizedByRole: string;
  createdAt: Date;
}

export interface CreateAppointmentAuditLogInput {
  action: string;
  previousStatus: AppointmentStatusValue;
  newStatus: AppointmentStatusValue;
  reason: string;
  authorizedById: string;
  authorizedByName: string;
  authorizedByRole: string;
}

export interface AppointmentsRepository {
  /**
   * Cria o agendamento de forma atômica sob lock exclusivo por (companyId, collaboratorId),
   * rejeitando com AppointmentTimeConflictError caso exista qualquer agendamento ativo sobreposto.
   */
  createWithLock(appointment: Appointment, details?: PublicBookingDetails): Promise<void>;

  /**
   * Reprograma o agendamento de forma atômica sob lock exclusivo por (companyId, collaboratorId),
   * ignorando o próprio `appointment.id` na verificação de sobreposição.
   */
  rescheduleWithLock(appointment: Appointment): Promise<void>;

  save(
    appointment: Appointment,
    expected: Pick<Appointment, "status" | "startsAt" | "collaboratorId">,
  ): Promise<void>;

  /**
   * Reverte um agendamento COMPLETED para CONFIRMED de forma atômica, bloqueando se houver
   * pagamentos líquidos ativos e registrando a trilha de auditoria na mesma transação.
   */
  revertCompletionWithAudit(
    appointment: Appointment,
    expected: Pick<Appointment, "status" | "startsAt" | "collaboratorId">,
    audit: CreateAppointmentAuditLogInput,
  ): Promise<AppointmentAuditLogRecord>;

  listAuditLogs(
    companyId: string,
    appointmentId: string,
  ): Promise<AppointmentAuditLogRecord[]>;

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
