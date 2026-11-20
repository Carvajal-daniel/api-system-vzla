import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import type { Appointment } from "../../domain/entities/appointment.entity.js";
import type { ScheduleBlock } from "../../domain/entities/schedule-block.entity.js";

export interface ScheduleBlockOutputDTO {
  id: string;
  companyId: string;
  collaboratorId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AffectedAppointmentSummaryDTO {
  id: string;
  collaboratorId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startsAt: string;
  endsAt: string;
  status: "PENDING" | "CONFIRMED";
}

export interface CreateScheduleBlockInputDTO {
  actor: ActorContext;
  collaboratorId?: string | null;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export interface CreateScheduleBlockOutputDTO {
  block: ScheduleBlockOutputDTO;
  affectedAppointments: AffectedAppointmentSummaryDTO[];
}

export interface ListScheduleBlocksInputDTO {
  actor: ActorContext;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface DeleteScheduleBlockInputDTO {
  actor: ActorContext;
  blockId: string;
}

export function toScheduleBlockOutputDTO(
  block: ScheduleBlock,
): ScheduleBlockOutputDTO {
  return {
    id: block.id,
    companyId: block.companyId,
    collaboratorId: block.collaboratorId,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    reason: block.reason,
    createdAt: block.createdAt.toISOString(),
    updatedAt: block.updatedAt.toISOString(),
  };
}

export function toAffectedAppointmentSummaryDTO(
  appointment: Appointment,
): AffectedAppointmentSummaryDTO {
  return {
    id: appointment.id,
    collaboratorId: appointment.collaboratorId,
    serviceId: appointment.serviceId,
    clientName: appointment.clientName,
    clientPhone: appointment.clientPhone,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status as "PENDING" | "CONFIRMED",
  };
}
