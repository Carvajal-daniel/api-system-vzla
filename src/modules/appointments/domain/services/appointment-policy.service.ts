import { DomainError } from "../../../../shared/Errors/domain-error.js";

export interface ClubMembershipPolicy {
  status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
  dueAt: Date | null;
  allowedDaysOfWeek: number[] | null;
  gracePeriodDays: number;
}

export interface AppointmentPolicyConflict {
  id: string;
  startsAt: string;
  endsAt: string;
  serviceId: string;
  serviceName: string;
  collaboratorId: string;
  status: string;
}

export class AppointmentPolicyError extends DomainError {
  constructor(
    reason: "SUBSCRIBER_ACTIVE_APPOINTMENT_EXISTS" | "PLAN_DAY_RESTRICTED" | "APPOINTMENT_ALREADY_STARTED",
    message: string,
    readonly currentAppointment?: AppointmentPolicyConflict,
  ) {
    super(message, "CONFLICT", reason);
  }
}

export class AppointmentPolicyService {
  static assertAiCanChange(startsAt: Date, now: Date): void {
    if (startsAt <= now) {
      throw new AppointmentPolicyError("APPOINTMENT_ALREADY_STARTED", "O agendamento já começou. A equipe deve tratar alterações.");
    }
  }

  static evaluate(input: {
    membership: ClubMembershipPolicy | undefined;
    existing?: AppointmentPolicyConflict;
    isGuest: boolean;
    payFullPrice: boolean;
    dayOfWeek: number;
    now: Date;
  }): boolean {
    const { membership, existing, isGuest, payFullPrice, dayOfWeek, now } = input;
    if (isGuest || !membership) return false;

    if (membership.status === "ACTIVE" && existing) {
      throw new AppointmentPolicyError(
        "SUBSCRIBER_ACTIVE_APPOINTMENT_EXISTS",
        "Já existe um agendamento futuro. Ofereça somente a remarcação atômica desse agendamento.",
        existing,
      );
    }

    const inGracePeriod = (membership.status === "PAST_DUE" || membership.status === "SUSPENDED") &&
      membership.dueAt !== null &&
      now.getTime() < membership.dueAt.getTime() + membership.gracePeriodDays * 86_400_000;
    if (payFullPrice || (membership.status !== "ACTIVE" && !inGracePeriod)) return false;

    if (membership.allowedDaysOfWeek !== null && !membership.allowedDaysOfWeek.includes(dayOfWeek)) {
      throw new AppointmentPolicyError(
        "PLAN_DAY_RESTRICTED",
        "O benefício não vale nesse dia. Ofereça agendamento avulso pelo preço cheio ou upgrade de plano.",
      );
    }
    return true;
  }
}
