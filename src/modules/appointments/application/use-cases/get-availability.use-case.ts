import {
  AppointmentNotFoundError,
  CollaboratorNotEnabledForServiceError,
  InvalidLocalDateError,
  SchedulingCompanyNotFoundError,
  SchedulingServiceNotFoundError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { EnabledCollaboratorForServiceContext, SchedulingContextLookupRepository } from "../../domain/repositories/scheduling-context-lookup.repository.js";
import { AvailabilityCalculator, DEFAULT_SLOT_STEP_MINUTES, getCompanyHours } from "../../domain/services/availability-calculator.js";
import { assertValidIanaTimeZone, getLocalDayUtcBounds, parseLocalDateString } from "../../domain/services/timezone-utils.js";
import type { GetAvailabilityInputDTO, GetAvailabilityOutputDTO } from "../dtos/availability.dtos.js";

export class GetAvailabilityUseCase {
  constructor(
    private readonly lookupRepository: SchedulingContextLookupRepository,
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async execute(input: GetAvailabilityInputDTO): Promise<GetAvailabilityOutputDTO> {
    const [day] = await this.calculate(input, [input.date]);
    return day!;
  }

  async listAvailableDays(input: Omit<GetAvailabilityInputDTO, "date"> & { from: string; to: string }) {
    const first = calendarDay(input.from);
    const last = calendarDay(input.to);
    const count = Math.round((last - first) / 86_400_000) + 1;
    if (count < 1 || count > 31) throw new InvalidLocalDateError("Availability range must contain 1–31 days.");
    const dates = Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
    const days = await this.calculate(input, dates);
    return { availableDays: days.filter((day) => day.slots.length > 0).map((day) => day.date) };
  }

  private async calculate(input: Omit<GetAvailabilityInputDTO, "date">, dates: string[]): Promise<GetAvailabilityOutputDTO[]> {
    const { companyId, serviceId, collaboratorId } = input;
    const company = await this.lookupRepository.findCompanyById(companyId);
    if (!company?.isActive) throw new SchedulingCompanyNotFoundError();
    // Keep accepting the legacy timezone parameter without shifting the company’s booking grid.
    if (input.timezone) assertValidIanaTimeZone(input.timezone);
    const timezone = assertValidIanaTimeZone(company.timezone);
    const days = dates.map((date) => {
      const bounds = getLocalDayUtcBounds(date, timezone);
      return { date, ...bounds, hours: getCompanyHours(company, bounds.dayOfWeek) };
    });
    const empty = (date: string): GetAvailabilityOutputDTO => ({
      companyId, serviceId, date, timezone, slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES, serviceDurationMinutes: 0, slots: [],
    });
    const now = input.now ?? new Date();
    const open = days.filter((day) => day.hours !== false && day.endUtc > now);
    if (days.every((day) => day.hours === false)) return dates.map(empty);

    const service = await this.lookupRepository.findServiceById(companyId, serviceId);
    const existing = input.appointmentId ? await this.appointmentsRepository.findById(companyId, input.appointmentId) : null;
    if (input.appointmentId && (!existing || existing.serviceId !== serviceId)) throw new AppointmentNotFoundError();
    if ((!service || !service.active) && !existing) throw new SchedulingServiceNotFoundError();
    const duration = existing?.serviceDurationMinutesSnapshot ?? service!.durationMinutes;

    let staff: EnabledCollaboratorForServiceContext[];
    if (collaboratorId) {
      const person = await this.lookupRepository.findEnabledCollaboratorForService(companyId, serviceId, collaboratorId);
      if (!person?.isActive) throw new CollaboratorNotEnabledForServiceError();
      staff = [person];
    } else {
      staff = await this.lookupRepository.listEnabledActiveCollaboratorsForService(companyId, serviceId);
    }

    const results = days.map((day) => ({ ...empty(day.date), serviceDurationMinutes: day.hours === false ? 0 : duration }));
    if (!open.length) return results;
    const byDate = new Map(results.map((day) => [day.date, day]));
    const weekdays = [...new Set(open.map((day) => day.dayOfWeek))];
    const from = open[0]!.startUtc;
    const to = open.at(-1)!.endUtc;

    for (const person of staff) {
      const id = person.collaboratorId;
      const [schedules, blocks, appointments] = await Promise.all([
        Promise.all(weekdays.map((day) => this.lookupRepository.findWorkScheduleForDay(companyId, id, day))),
        this.scheduleBlocksRepository.findOverlappingForCollaborator(companyId, id, from, to),
        this.appointmentsRepository.findActiveOverlapping(companyId, from, to, id),
      ]);
      const scheduleByDay = new Map(weekdays.map((day, index) => [day, schedules[index] ?? null]));
      const blockRanges = blocks.map((block) => block.toTimeRange());
      const appointmentRanges = appointments.filter((row) => row.id !== existing?.id).map((row) => row.toTimeRange());
      for (const day of open) {
        const slots = AvailabilityCalculator.calculateSlotsForCollaborator({
          date: day.date, timezone, serviceDurationMinutes: duration, now,
          collaborator: { id, name: person.collaboratorName }, workSchedule: scheduleByDay.get(day.dayOfWeek) ?? null,
          companyOperatingHours: day.hours || null, blocks: blockRanges, activeAppointments: appointmentRanges,
        });
        byDate.get(day.date)!.slots.push(...slots.map((slot) => ({
          ...slot, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(),
        })));
      }
    }
    for (const day of results) day.slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.collaboratorName.localeCompare(b.collaboratorName));
    return results;
  }
}

function calendarDay(date: string) {
  const { year, month, day } = parseLocalDateString(date);
  return Date.UTC(year, month - 1, day);
}
