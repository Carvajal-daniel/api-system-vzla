import type { SchedulingActorSource } from "./appointment.dtos.js";

export interface GetAvailabilityInputDTO {
  companyId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD
  collaboratorId?: string | undefined;
  appointmentId?: string | undefined;
  timezone?: string | undefined;
  now?: Date | undefined;
  actorSource?: SchedulingActorSource | undefined;
}

export interface AvailabilitySlotOutputDTO {
  startsAt: string;
  endsAt: string;
  collaboratorId: string;
  collaboratorName: string;
}

export interface GetAvailabilityOutputDTO {
  companyId: string;
  serviceId: string;
  date: string;
  timezone: string;
  slotStepMinutes: number;
  serviceDurationMinutes: number;
  slots: AvailabilitySlotOutputDTO[];
}
