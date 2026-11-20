import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import type { Appointment } from "../../domain/entities/appointment.entity.js";
import type {
  AppointmentStatusValue,
  InitialAppointmentStatusValue,
} from "../../domain/value-objects/appointment-status.vo.js";

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
  now?: Date | undefined;
}

export interface CreateInternalAppointmentInputDTO {
  actor: ActorContext;
  serviceId: string;
  collaboratorId: string;
  startsAt: Date;
  clientName: string;
  clientPhone: string;
  initialStatus?: InitialAppointmentStatusValue | undefined;
  now?: Date | undefined;
}

export interface ListAppointmentsInputDTO {
  actor: ActorContext;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  status?: AppointmentStatusValue | undefined;
}

export interface UpdateAppointmentStatusInputDTO {
  actor: ActorContext;
  appointmentId: string;
  status: AppointmentStatusValue;
  cancellationReason?: string | null;
}

export interface RescheduleAppointmentInputDTO {
  actor: ActorContext;
  appointmentId: string;
  startsAt: Date;
  collaboratorId?: string | undefined;
  now?: Date | undefined;
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
    serviceNameSnapshot: appointment.serviceNameSnapshot,
    servicePriceInCentsSnapshot: appointment.servicePriceInCentsSnapshot,
    serviceDurationMinutesSnapshot: appointment.serviceDurationMinutesSnapshot,
    commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };
}
