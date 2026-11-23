import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import type {
  AppointmentAuditLogRecord,
  PublicBookingDetails,
} from "../../domain/repositories/appointments.repository.js";
import type { Appointment } from "../../domain/entities/appointment.entity.js";
import type {
  AppointmentStatusValue,
  InitialAppointmentStatusValue,
} from "../../domain/value-objects/appointment-status.vo.js";

export type SchedulingActorSource =
  | "OWNER"
  | "COLLABORATOR"
  | "PUBLIC"
  | "WHATSAPP_AI";

export interface AppointmentOutputDTO {
  id: string;
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatusValue;
  cancellationReason: string | null;
  notes: string | null;
  serviceNameSnapshot: string;
  servicePriceInCentsSnapshot: number;
  serviceDurationMinutesSnapshot: number;
  commissionPercentageSnapshot: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePublicAppointmentInputDTO {
  companyId: string;
  serviceId: string;
  collaboratorId: string;
  startsAt: Date;
  clientName: string;
  clientPhone: string;
  publicDetails?: PublicBookingDetails | undefined;
  now?: Date | undefined;
  actorSource?: SchedulingActorSource | undefined;
}

export interface CreateInternalAppointmentInputDTO {
  actor: ActorContext;
  serviceId: string;
  collaboratorId: string;
  startsAt: Date;
  clientName: string;
  clientPhone: string;
  notes?: string | undefined;
  initialStatus?: InitialAppointmentStatusValue | undefined;
  now?: Date | undefined;
  actorSource?: SchedulingActorSource | undefined;
}

export interface ListAppointmentsInputDTO {
  actor: ActorContext;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  status?: AppointmentStatusValue | undefined;
  actorSource?: SchedulingActorSource | undefined;
}

export interface UpdateAppointmentStatusInputDTO {
  actor: ActorContext;
  appointmentId: string;
  status: AppointmentStatusValue;
  cancellationReason?: string | null;
  now?: Date;
  actorSource?: SchedulingActorSource | undefined;
}

export interface RescheduleAppointmentInputDTO {
  actor: ActorContext;
  appointmentId: string;
  startsAt: Date;
  collaboratorId?: string | undefined;
  now?: Date | undefined;
  actorSource?: SchedulingActorSource | undefined;
}

export interface AppointmentAuditLogOutputDTO {
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
  createdAt: string;
}

export function toAppointmentAuditLogOutputDTO(
  record: AppointmentAuditLogRecord,
): AppointmentAuditLogOutputDTO {
  return {
    id: record.id,
    companyId: record.companyId,
    appointmentId: record.appointmentId,
    action: record.action,
    previousStatus: record.previousStatus,
    newStatus: record.newStatus,
    reason: record.reason,
    authorizedById: record.authorizedById,
    authorizedByName: record.authorizedByName,
    authorizedByRole: record.authorizedByRole,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toAppointmentOutputDTO(
  appointment: Appointment,
): AppointmentOutputDTO {
  return {
    id: appointment.id,
    companyId: appointment.companyId,
    collaboratorId: appointment.collaboratorId,
    serviceId: appointment.serviceId,
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    cancellationReason: appointment.cancellationReason,
    notes: appointment.notes,
    serviceNameSnapshot: appointment.serviceNameSnapshot,
    servicePriceInCentsSnapshot: appointment.servicePriceInCentsSnapshot,
    serviceDurationMinutesSnapshot: appointment.serviceDurationMinutesSnapshot,
    commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}
