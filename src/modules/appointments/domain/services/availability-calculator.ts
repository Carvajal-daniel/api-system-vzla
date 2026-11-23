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

export function isWithinPublicBookingWindow(company: ActiveCompanyContext, now: Date, date: string) {
  if (company.maxAdvanceBookingDays == null) return true;
  const { year, month, day } = getLocalDateTimeParts(now, company.timezone);
  const target = parseLocalDateString(date);
  return (Date.UTC(target.year, target.month - 1, target.day) - Date.UTC(year, month - 1, day)) / 86_400_000
    <= company.maxAdvanceBookingDays;
}

export interface DailyWorkScheduleData {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

type CompanyHours = { openTime: string; closeTime: string } |
  NonNullable<NonNullable<ActiveCompanyContext["operatingSchedule"]>[number]["shifts"]> | null | false;

export function getCompanyHours(company: ActiveCompanyContext, dayOfWeek: number): CompanyHours {
  if (Array.isArray(company.operatingSchedule)) {
    const entry = company.operatingSchedule.find((day) => day.dayOfWeek === dayOfWeek);
    if (entry) {
      if (!entry.isOpen) return false;
      if (entry.shifts) return entry.shifts.length ? entry.shifts : false;
      return entry.openTime && entry.closeTime ? [{ start: entry.openTime, end: entry.closeTime }] : false;
    }
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
  if (!schedule?.isWorkingDay || !schedule.startTime || !schedule.endTime || hours === false) return [];
  const opens = minutes(schedule.startTime);
  const closes = minutes(schedule.endTime);
  const shifts = Array.isArray(hours) ? hours : hours ? [{ start: hours.openTime, end: hours.closeTime }] : null;
  const ranges = shifts?.map(({ start, end }) => ({
    start: Math.max(opens, minutes(start)),
    end: Math.min(closes, minutes(end)),
  })) ?? [{ start: opens, end: closes }];
  return ranges.filter(({ start, end }) => start < end);
}

function collaboratorPause(schedule: DailyWorkScheduleData | null, instant: (minute: number) => Date) {
  return schedule?.breakStart && schedule.breakEnd
    ? TimeRange.create(instant(minutes(schedule.breakStart)), instant(minutes(schedule.breakEnd))) : null;
}

export class AvailabilityCalculator {
  static calculateSlotsForCollaborator(input: CalculateCollaboratorSlotsInput): CalculatedAvailabilitySlot[] {
    const timezone = assertValidIanaTimeZone(input.timezone);
    const { year, month, day } = parseLocalDateString(input.date);
    const bounds = workingBounds(input.workSchedule, input.companyOperatingHours);
    if (!bounds.length) return [];

    const instant = (minute: number) => localDateTimeToUtc(year, month, day, Math.floor(minute / 60), minute % 60, timezone);
    const pause = collaboratorPause(input.workSchedule, instant);
    const step = input.step ?? DEFAULT_SLOT_STEP_MINUTES;
    const unavailable = [...input.blocks, ...(input.activeAppointments ?? [])];
    const slots: CalculatedAvailabilitySlot[] = [];

    for (const { start, end: endMinute } of bounds) {
      const end = instant(endMinute);
      for (let minute = Math.ceil(start / step) * step; minute < endMinute; minute += step) {
        const startsAt = instant(minute);
        const local = getLocalDateTimeParts(startsAt, timezone);
        if (local.dateString !== input.date || local.minutesFromMidnight !== minute || startsAt <= input.now) continue;
        const endsAt = new Date(startsAt.getTime() + input.serviceDurationMinutes * 60_000);
        if (endsAt > end) continue;
        const candidate = TimeRange.create(startsAt, endsAt);
        if (pause?.overlaps(candidate) || unavailable.some((busy) => busy.overlaps(candidate))) continue;
        slots.push({ startsAt, endsAt, collaboratorId: input.collaborator.id, collaboratorName: input.collaborator.name });
      }
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
    if (start.dateString !== end.dateString || input.workSchedule?.dayOfWeek !== start.dayOfWeek ||
        !bounds.some((range) => startsAt >= instant(range.start) && endsAt <= instant(range.end))) {
      throw new AppointmentOutsideWorkScheduleError();
    }
    if (collaboratorPause(input.workSchedule, instant)?.overlaps(candidate)) {
      throw new AppointmentDuringBreakError();
    }
    if (input.blocks.some((block) => block.overlaps(candidate))) throw new AppointmentBlockedError();
    if (input.activeAppointments?.some((existing) => existing.overlaps(candidate))) throw new AppointmentTimeConflictError();
    return candidate;
  }
}
