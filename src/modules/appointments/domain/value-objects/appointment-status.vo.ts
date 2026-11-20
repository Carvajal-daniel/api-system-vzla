import {
  InvalidAppointmentStatusError,
  InvalidAppointmentStatusTransitionError,
} from "../errors/appointment-errors.js";

export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "COMPLETED",
  "CANCELED",
  "NO_SHOW",
] as const;

export type AppointmentStatusValue = (typeof APPOINTMENT_STATUSES)[number];

export type InitialAppointmentStatusValue = "PENDING" | "CONFIRMED";

// Matriz explícita de transições permitidas no ciclo de vida do agendamento.
const ALLOWED_TRANSITIONS: Record<
  AppointmentStatusValue,
  readonly AppointmentStatusValue[]
> = {
  PENDING: ["CONFIRMED", "CANCELED"],
  CONFIRMED: ["COMPLETED", "CANCELED", "NO_SHOW"],
  COMPLETED: [],
  CANCELED: [],
  NO_SHOW: [],
};

export class AppointmentStatus {
  private constructor(public readonly value: AppointmentStatusValue) {
    Object.freeze(this);
  }

  static create(raw: string): AppointmentStatus {
    if (!APPOINTMENT_STATUSES.includes(raw as AppointmentStatusValue)) {
      throw new InvalidAppointmentStatusError();
    }
    return new AppointmentStatus(raw as AppointmentStatusValue);
  }

  canTransitionTo(target: AppointmentStatusValue): boolean {
    return ALLOWED_TRANSITIONS[this.value].includes(target);
  }

  transitionTo(target: AppointmentStatusValue): AppointmentStatus {
    if (!this.canTransitionTo(target)) {
      throw new InvalidAppointmentStatusTransitionError(this.value, target);
    }
    return new AppointmentStatus(target);
  }

  // Apenas agendamentos PENDING e CONFIRMED ocupam a agenda; CANCELED e NO_SHOW liberam o horário.
  blocksAvailability(): boolean {
    return this.value === "PENDING" || this.value === "CONFIRMED";
  }

  isReschedulable(): boolean {
    return this.value === "PENDING" || this.value === "CONFIRMED";
  }

  isTerminal(): boolean {
    return ALLOWED_TRANSITIONS[this.value].length === 0;
  }
}
