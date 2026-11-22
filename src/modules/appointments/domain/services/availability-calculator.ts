import {
  AppointmentBlockedError,
  AppointmentDuringBreakError,
  AppointmentInPastError,
  AppointmentOutsideWorkScheduleError,
  AppointmentSlotAlignmentError,
  AppointmentTimeConflictError,
} from "../errors/appointment-errors.js";
import type { ActiveCompanyContext } from "../repositories/scheduling-context-lookup.repository.js";
import { TimeRange } from "../value-objects/time-range.vo.js";
import { assertValidIanaTimeZone, getLocalDateTimeParts, localDateTimeToUtc, parseLocalDateString, parseLocalTimeString } from "./timezone-utils.js";

export const DEFAULT_SLOT_STEP_MINUTES = 30;

export function companySlotStep(company: ActiveCompanyContext, publicBooking = false) {
  return (publicBooking ? company.bookingInterval : 0) || company.agendaInterval || DEFAULT_SLOT_STEP_MINUTES;
}

export interface DailyWorkScheduleData {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

type CompanyHours = { openTime: string; closeTime: string } | null | false;

export function getCompanyHours(company: ActiveCompanyContext, dayOfWeek: number): CompanyHours {
  if (Array.isArray(company.operatingSchedule)) {
    const entry = company.operatingSchedule.find((day) => day.dayOfWeek === dayOfWeek);
    if (entry) return entry.isOpen && entry.openTime && entry.closeTime
      ? { openTime: entry.openTime, closeTime: entry.closeTime } : false;
  }
  if (company.operatingDays && !company.operatingDays.split(",").some((day) => day.trim() === String(dayOfWeek))) return false;
  return null;
}

export interface CalculatedAvailabilitySlot {
  startsAt: Date;
  endsAt: Date;
  collaboratorId: string;
  collaboratorName: string;
}

interface SlotContext {
  timezone: string;
  serviceDurationMinutes: number;
  now: Date;
  step?: number | undefined;
  workSchedule: DailyWorkScheduleData | null;
  companyOperatingHours?: CompanyHours;
  blocks: readonly TimeRange[];
  activeAppointments?: readonly TimeRange[];
}

export interface CalculateCollaboratorSlotsInput extends SlotContext {
  date: string;
  collaborator: { id: string; name: string };
}

export interface ValidateSlotAvailabilityInput extends SlotContext {
  startsAt: Date;
}

function minutes(time: string) {
  const { hour, minute } = parseLocalTimeString(time);
  return hour * 60 + minute;
}

function workingBounds(schedule: DailyWorkScheduleData | null, hours: CompanyHours = null) {
  if (!schedule?.isWorkingDay || !schedule.startTime || !schedule.endTime || hours === false) return null;
  const start = Math.max(minutes(schedule.startTime), hours ? minutes(hours.openTime) : 0);
  const end = Math.min(minutes(schedule.endTime), hours ? minutes(hours.closeTime) : 1440);
  if (start >= end) return null;
  return { start, end, pause: schedule.breakStart && schedule.breakEnd
    ? { start: minutes(schedule.breakStart), end: minutes(schedule.breakEnd) } : null };
}

export class AvailabilityCalculator {
  static calculateSlotsForCollaborator(input: CalculateCollaboratorSlotsInput): CalculatedAvailabilitySlot[] {
    const timezone = assertValidIanaTimeZone(input.timezone);
    const { year, month, day } = parseLocalDateString(input.date);
    const bounds = workingBounds(input.workSchedule, input.companyOperatingHours);
    if (!bounds) return [];

    const instant = (minute: number) => localDateTimeToUtc(year, month, day, Math.floor(minute / 60), minute % 60, timezone);
    const end = instant(bounds.end);
    const pause = bounds.pause ? TimeRange.create(instant(bounds.pause.start), instant(bounds.pause.end)) : null;
    const step = input.step ?? DEFAULT_SLOT_STEP_MINUTES;
    const unavailable = [...input.blocks, ...(input.activeAppointments ?? [])];
    const slots: CalculatedAvailabilitySlot[] = [];

    for (let minute = Math.ceil(bounds.start / step) * step; minute < bounds.end; minute += step) {
      const startsAt = instant(minute);
      const local = getLocalDateTimeParts(startsAt, timezone);
      if (local.dateString !== input.date || local.minutesFromMidnight !== minute || startsAt <= input.now) continue;
      const endsAt = new Date(startsAt.getTime() + input.serviceDurationMinutes * 60_000);
      if (endsAt > end) continue;
      const candidate = TimeRange.create(startsAt, endsAt);
      if (pause?.overlaps(candidate) || unavailable.some((busy) => busy.overlaps(candidate))) continue;
      slots.push({ startsAt, endsAt, collaboratorId: input.collaborator.id, collaboratorName: input.collaborator.name });
    }
    return slots;
  }

  static validateSlotAvailability(input: ValidateSlotAvailabilityInput): TimeRange {
    const timezone = assertValidIanaTimeZone(input.timezone);
    const startsAt = input.startsAt;
    const endsAt = new Date(startsAt.getTime() + input.serviceDurationMinutes * 60_000);
    const candidate = TimeRange.create(startsAt, endsAt);
    if (startsAt <= input.now) throw new AppointmentInPastError();

    const start = getLocalDateTimeParts(startsAt, timezone);
    const end = getLocalDateTimeParts(endsAt, timezone);
    const step = input.step ?? DEFAULT_SLOT_STEP_MINUTES;
    if (start.minutesFromMidnight % step !== 0 || start.second !== 0 || startsAt.getMilliseconds() !== 0) {
      throw new AppointmentSlotAlignmentError(step);
    }
    const bounds = workingBounds(input.workSchedule, input.companyOperatingHours);
    const instant = (minute: number) => localDateTimeToUtc(start.year, start.month, start.day, Math.floor(minute / 60), minute % 60, timezone);
    if (!bounds || start.dateString !== end.dateString || input.workSchedule?.dayOfWeek !== start.dayOfWeek ||
        startsAt < instant(bounds.start) || endsAt > instant(bounds.end)) throw new AppointmentOutsideWorkScheduleError();
    if (bounds.pause && candidate.overlaps(TimeRange.create(instant(bounds.pause.start), instant(bounds.pause.end)))) {
      throw new AppointmentDuringBreakError();
    }
    if (input.blocks.some((block) => block.overlaps(candidate))) throw new AppointmentBlockedError();
    if (input.activeAppointments?.some((existing) => existing.overlaps(candidate))) throw new AppointmentTimeConflictError();
    return candidate;
  }
}
