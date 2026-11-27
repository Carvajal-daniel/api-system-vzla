import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { getLocalDayUtcBounds } from "../../appointments/domain/services/timezone-utils.js";
import { buildCascadeDelayMessage, OperationsDomainError } from "../domain/operations-rules.js";
import type { OperationsNotificationPort } from "./ports/operations-notification.port.js";

export const ALLOWED_CASCADE_DELAY_MINUTES = [15, 30, 45] as const;
export type CascadeDelayMinutes = (typeof ALLOWED_CASCADE_DELAY_MINUTES)[number];

export interface ShiftedAppointmentRecord {
  id: string;
  clientName: string;
  clientPhone: string;
  previousStartsAt: Date;
  previousEndsAt: Date;
  newStartsAt: Date;
  newEndsAt: Date;
  status: string;
}

export interface CascadeDelayRepositoryPort {
  findCompanyAndCollaborator(
    companyId: string,
    collaboratorId: string,
  ): Promise<{
    timezone: string;
    collaboratorName: string;
  } | null>;
  shiftFutureAppointmentsInDay(params: {
    companyId: string;
    collaboratorId: string;
    windowStartUtc: Date;
    windowEndUtc: Date;
    delayMinutes: number;
    now: Date;
  }): Promise<ShiftedAppointmentRecord[]>;
}

export interface CascadeDelayInput {
  actor: ActorContext;
  collaboratorId: string;
  date: string;
  delayMinutes: CascadeDelayMinutes;
  now?: Date | undefined;
}

export interface CascadeDelayOutput {
  collaboratorId: string;
  date: string;
  delayMinutes: CascadeDelayMinutes;
  affectedCount: number;
  notifiedCount: number;
  appointments: Array<{
    id: string;
    clientName: string;
    previousStartsAt: string;
    newStartsAt: string;
    newEndsAt: string;
    notified: boolean;
  }>;
}

// Desloca em cascata os agendamentos futuros do dia de um profissional e avisa apenas os clientes afetados via L0 (0 tokens).
export class CascadeDelayUseCase {
  constructor(
    private readonly repository: CascadeDelayRepositoryPort,
    private readonly notificationPort: OperationsNotificationPort,
  ) {}

  async execute(input: CascadeDelayInput): Promise<CascadeDelayOutput> {
    if (
      input.actor.role === "COLLABORATOR" &&
      input.actor.collaboratorId !== input.collaboratorId
    ) {
      throw new OperationsDomainError(
        "Collaborators can only apply cascade delay to their own schedule.",
        "FORBIDDEN",
        "UNAUTHORIZED_CASCADE_DELAY",
      );
    }

    const context = await this.repository.findCompanyAndCollaborator(
      input.actor.companyId,
      input.collaboratorId,
    );
    if (!context) {
      throw new OperationsDomainError(
        "Collaborator not found in this company.",
        "NOT_FOUND",
        "COLLABORATOR_NOT_FOUND",
      );
    }

    const now = input.now ?? new Date();
    const { startUtc, endUtc } = getLocalDayUtcBounds(input.date, context.timezone);
    const windowStartUtc = now > startUtc ? now : startUtc;

    if (windowStartUtc >= endUtc) {
      return {
        collaboratorId: input.collaboratorId,
        date: input.date,
        delayMinutes: input.delayMinutes,
        affectedCount: 0,
        notifiedCount: 0,
        appointments: [],
      };
    }

    const shifted = await this.repository.shiftFutureAppointmentsInDay({
      companyId: input.actor.companyId,
      collaboratorId: input.collaboratorId,
      windowStartUtc,
      windowEndUtc: endUtc,
      delayMinutes: input.delayMinutes,
      now,
    });

    let notifiedCount = 0;
    const appointments: CascadeDelayOutput["appointments"] = [];

    for (const appt of shifted) {
      const text = buildCascadeDelayMessage({
        clientName: appt.clientName,
        collaboratorName: context.collaboratorName,
        delayMinutes: input.delayMinutes,
        newStartsAt: appt.newStartsAt,
        timezone: context.timezone,
      });

      const dispatch = await this.notificationPort.sendOperationalMessage({
        companyId: input.actor.companyId,
        phone: appt.clientPhone,
        contactName: appt.clientName,
        text,
        kind: "CASCADE_DELAY",
        metadata: {
          appointmentId: appt.id,
          collaboratorId: input.collaboratorId,
          delayMinutes: input.delayMinutes,
          newStartsAt: appt.newStartsAt.toISOString(),
        },
        recordL0Telemetry: true,
        now,
      });

      if (dispatch.delivered) {
        notifiedCount += 1;
      }

      appointments.push({
        id: appt.id,
        clientName: appt.clientName,
        previousStartsAt: appt.previousStartsAt.toISOString(),
        newStartsAt: appt.newStartsAt.toISOString(),
        newEndsAt: appt.newEndsAt.toISOString(),
        notified: dispatch.delivered,
      });
    }

    return {
      collaboratorId: input.collaboratorId,
      date: input.date,
      delayMinutes: input.delayMinutes,
      affectedCount: shifted.length,
      notifiedCount,
      appointments,
    };
  }
}
