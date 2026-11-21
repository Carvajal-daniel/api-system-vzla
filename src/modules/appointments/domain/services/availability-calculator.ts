import {
  AppointmentBlockedError,
  AppointmentDuringBreakError,
  AppointmentInPastError,
  AppointmentOutsideWorkScheduleError,
  AppointmentTimeConflictError,
} from "../errors/appointment-errors.js";
import { TimeRange } from "../value-objects/time-range.vo.js";
import {
  assertValidIanaTimeZone,
  getLocalDateTimeParts,
  localDateTimeToUtc,
  parseLocalDateString,
  parseLocalTimeString,
} from "./timezone-utils.js";

export const DEFAULT_SLOT_STEP_MINUTES = 15;

export interface DailyWorkScheduleData {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface CalculatedAvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
  collaboratorId: string;
  collaboratorName: string;
}

export interface CalculateCollaboratorSlotsInput {
  date: string; // YYYY-MM-DD no fuso da empresa
  timezone: string;
  serviceDurationMinutes: number;
  slotStepMinutes?: number;
  now: Date;
  collaborator: {
    id: string;
    name: string;
  };
  workSchedule: DailyWorkScheduleData | null;
  companyOperatingHours?: { openTime: string; closeTime: string } | null;
  blocks: readonly TimeRange[];
  activeAppointments: readonly TimeRange[];
}

export interface ValidateSlotAvailabilityInput {
  startsAt: Date;
  serviceDurationMinutes: number;
  timezone: string;
  now: Date;
  workSchedule: DailyWorkScheduleData | null;
  blocks: readonly TimeRange[];
  activeAppointments?: readonly TimeRange[];
}

export class AvailabilityCalculator {
  /**
   * Calcula os horários disponíveis para um colaborador em uma data local,
   * cruzando expediente, descanso, bloqueios (individuais/globais), agendamentos ativos e instante atual.
   */
  static calculateSlotsForCollaborator(
    input: CalculateCollaboratorSlotsInput,
  ): CalculatedAvailabilitySlot[] {
    const validTz = assertValidIanaTimeZone(input.timezone);
    const { year, month, day } = parseLocalDateString(input.date);
    const stepMinutes = input.slotStepMinutes ?? DEFAULT_SLOT_STEP_MINUTES;
    const durationMs = input.serviceDurationMinutes * 60_000;
    const stepMs = stepMinutes * 60_000;

    const schedule = input.workSchedule;
    if (
      !schedule ||
      !schedule.isWorkingDay ||
      !schedule.startTime ||
      !schedule.endTime
    ) {
      return [];
    }

    let workStart = parseLocalTimeString(schedule.startTime);
    let workEnd = parseLocalTimeString(schedule.endTime);

    // Se a barbearia/salão definiu horário de funcionamento para hoje, intersecta os limites
    if (input.companyOperatingHours) {
      const compOpen = parseLocalTimeString(input.companyOperatingHours.openTime);
      const compClose = parseLocalTimeString(input.companyOperatingHours.closeTime);

      const compOpenMinutes = compOpen.hour * 60 + compOpen.minute;
      const compCloseMinutes = compClose.hour * 60 + compClose.minute;
      const workStartMinutes = workStart.hour * 60 + workStart.minute;
      const workEndMinutes = workEnd.hour * 60 + workEnd.minute;

      const effectiveStartMinutes = Math.max(workStartMinutes, compOpenMinutes);
      const effectiveEndMinutes = Math.min(workEndMinutes, compCloseMinutes);

      if (effectiveStartMinutes >= effectiveEndMinutes) {
        return [];
      }

      workStart = {
        hour: Math.floor(effectiveStartMinutes / 60),
        minute: effectiveStartMinutes % 60,
      };
      workEnd = {
        hour: Math.floor(effectiveEndMinutes / 60),
        minute: effectiveEndMinutes % 60,
      };
    }

    const windows: TimeRange[] = [];

    if (schedule.breakStart && schedule.breakEnd) {
      const breakStart = parseLocalTimeString(schedule.breakStart);
      const breakEnd = parseLocalTimeString(schedule.breakEnd);

      windows.push(
        TimeRange.create(
          localDateTimeToUtc(year, month, day, workStart.hour, workStart.minute, validTz),
          localDateTimeToUtc(year, month, day, breakStart.hour, breakStart.minute, validTz),
        ),
      );
      windows.push(
        TimeRange.create(
          localDateTimeToUtc(year, month, day, breakEnd.hour, breakEnd.minute, validTz),
          localDateTimeToUtc(year, month, day, workEnd.hour, workEnd.minute, validTz),
        ),
      );
    } else {
      windows.push(
        TimeRange.create(
          localDateTimeToUtc(year, month, day, workStart.hour, workStart.minute, validTz),
          localDateTimeToUtc(year, month, day, workEnd.hour, workEnd.minute, validTz),
        ),
      );
    }

    const unavailableRanges: readonly TimeRange[] = [
      ...input.blocks,
      ...input.activeAppointments,
    ];

    const slots: CalculatedAvailabilitySlot[] = [];

    for (const window of windows) {
      let cursorMs = window.startsAt.getTime();
      const windowEndMs = window.endsAt.getTime();

      while (cursorMs + durationMs <= windowEndMs) {
        if (cursorMs > input.now.getTime()) {
          const candidate = TimeRange.create(
            new Date(cursorMs),
            new Date(cursorMs + durationMs),
          );

          const hasConflict = unavailableRanges.some((busy) =>
            busy.overlaps(candidate),
          );

          if (!hasConflict) {
            slots.push({
              startsAt: candidate.startsAt,
              endsAt: candidate.endsAt,
              collaboratorId: input.collaborator.id,
              collaboratorName: input.collaborator.name,
            });
          }
        }

        cursorMs += stepMs;
      }
    }

    return slots;
  }

  /**
   * Valida integralmente se um intervalo [startsAt, startsAt + duration) é reservável,
   * sem depender de consulta prévia ao endpoint /availability.
   */
  static validateSlotAvailability(input: ValidateSlotAvailabilityInput): TimeRange {
    const validTz = assertValidIanaTimeZone(input.timezone);
    const derivedEndsAt = new Date(
      input.startsAt.getTime() + input.serviceDurationMinutes * 60_000,
    );
    const candidate = TimeRange.create(input.startsAt, derivedEndsAt);

    if (candidate.startsAt.getTime() <= input.now.getTime()) {
      throw new AppointmentInPastError();
    }

    const startLocal = getLocalDateTimeParts(candidate.startsAt, validTz);
    const endLocal = getLocalDateTimeParts(candidate.endsAt, validTz);

    // A grade semanal atual não cruza meia-noite local dentro de um mesmo registro diário.
    if (startLocal.dateString !== endLocal.dateString) {
      throw new AppointmentOutsideWorkScheduleError();
    }

    const schedule = input.workSchedule;
    if (
      !schedule ||
      !schedule.isWorkingDay ||
      schedule.dayOfWeek !== startLocal.dayOfWeek ||
      !schedule.startTime ||
      !schedule.endTime
    ) {
      throw new AppointmentOutsideWorkScheduleError();
    }

    const workStart = parseLocalTimeString(schedule.startTime);
    const workEnd = parseLocalTimeString(schedule.endTime);

    const workStartUtc = localDateTimeToUtc(
      startLocal.year,
      startLocal.month,
      startLocal.day,
      workStart.hour,
      workStart.minute,
      validTz,
    );
    const workEndUtc = localDateTimeToUtc(
      startLocal.year,
      startLocal.month,
      startLocal.day,
      workEnd.hour,
      workEnd.minute,
      validTz,
    );

    if (
      candidate.startsAt.getTime() < workStartUtc.getTime() ||
      candidate.endsAt.getTime() > workEndUtc.getTime()
    ) {
      throw new AppointmentOutsideWorkScheduleError();
    }

    if (schedule.breakStart && schedule.breakEnd) {
      const breakStart = parseLocalTimeString(schedule.breakStart);
      const breakEnd = parseLocalTimeString(schedule.breakEnd);

      const breakRange = TimeRange.create(
        localDateTimeToUtc(
          startLocal.year,
          startLocal.month,
          startLocal.day,
          breakStart.hour,
          breakStart.minute,
          validTz,
        ),
        localDateTimeToUtc(
          startLocal.year,
          startLocal.month,
          startLocal.day,
          breakEnd.hour,
          breakEnd.minute,
          validTz,
        ),
      );

      if (candidate.overlaps(breakRange)) {
        throw new AppointmentDuringBreakError();
      }
    }

    const isBlocked = input.blocks.some((block) => block.overlaps(candidate));
    if (isBlocked) {
      throw new AppointmentBlockedError();
    }

    if (input.activeAppointments) {
      const hasAppointmentConflict = input.activeAppointments.some((existing) =>
        existing.overlaps(candidate),
      );
      if (hasAppointmentConflict) {
        throw new AppointmentTimeConflictError();
      }
    }

    return candidate;
  }
}
