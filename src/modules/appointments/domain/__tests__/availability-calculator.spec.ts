import { describe, expect, it } from "vitest";
import {
  AppointmentBlockedError,
  AppointmentDuringBreakError,
  AppointmentInPastError,
  AppointmentOutsideWorkScheduleError,
  AppointmentTimeConflictError,
} from "../errors/appointment-errors.js";
import {
  AvailabilityCalculator,
  type DailyWorkScheduleData,
} from "../services/availability-calculator.js";
import { localDateTimeToUtc } from "../services/timezone-utils.js";
import { TimeRange } from "../value-objects/time-range.vo.js";

describe("AvailabilityCalculator", () => {
  // 2026-11-25 é quarta-feira (dayOfWeek = 3)
  const wednesdaySchedule: DailyWorkScheduleData = {
    dayOfWeek: 3,
    isWorkingDay: true,
    startTime: "09:00",
    endTime: "12:00",
    breakStart: "10:30",
    breakEnd: "11:00",
  };

  it("generates 30-minute step slots respecting break, blocks, active appointments and timezone", () => {
    const tz = "America/Caracas"; // UTC-4
    const now = localDateTimeToUtc(2026, 11, 25, 8, 0, tz);

    // Bloqueio pontual de 09:00 às 09:30 local
    const block = TimeRange.create(
      localDateTimeToUtc(2026, 11, 25, 9, 0, tz),
      localDateTimeToUtc(2026, 11, 25, 9, 30, tz),
    );

    // Agendamento ativo (PENDING/CONFIRMED) de 11:00 às 11:30 local
    const activeAppt = TimeRange.create(
      localDateTimeToUtc(2026, 11, 25, 11, 0, tz),
      localDateTimeToUtc(2026, 11, 25, 11, 30, tz),
    );

    const slots = AvailabilityCalculator.calculateSlotsForCollaborator({
      date: "2026-11-25",
      timezone: tz,
      serviceDurationMinutes: 30,
      now,
      collaborator: { id: "collab-1", name: "Carlos" },
      workSchedule: wednesdaySchedule,
      blocks: [block],
      activeAppointments: [activeAppt],
    });

    // A grade em meia hora deixa 09:30, 10:00 e 11:30 livres.
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      localDateTimeToUtc(2026, 11, 25, 9, 30, tz).toISOString(),
      localDateTimeToUtc(2026, 11, 25, 10, 0, tz).toISOString(),
      localDateTimeToUtc(2026, 11, 25, 11, 30, tz).toISOString(),
    ]);
  });

  it.each([[20, 30], [45, 60]])("rounds a busy interval of %i minutes up to the next half hour", (duration, nextMinute) => {
    const tz = "America/Caracas";
    const instant = (hour: number, minute: number) => localDateTimeToUtc(2026, 11, 25, hour, minute, tz);
    const slots = AvailabilityCalculator.calculateSlotsForCollaborator({
      date: "2026-11-25", timezone: tz, serviceDurationMinutes: 20, now: instant(13, 0),
      collaborator: { id: "p", name: "Ana" },
      workSchedule: { ...wednesdaySchedule, startTime: "14:05", endTime: "18:00", breakStart: "16:00", breakEnd: "16:12" },
      companyOperatingHours: { openTime: "14:00", closeTime: "17:30" },
      blocks: [], activeAppointments: [TimeRange.create(instant(14, 0), instant(14, duration))],
    });
    expect(slots[0]?.startsAt).toEqual(instant(14 + Math.floor(nextMinute / 60), nextMinute % 60));
    expect(slots.find((slot) => slot.startsAt >= instant(16, 0))?.startsAt).toEqual(instant(16, 30));
    expect(slots.at(-1)?.endsAt).toEqual(instant(17, 20));
  });

  it("excludes past slots and returns empty when service is longer than every free window", () => {
    const tz = "America/Sao_Paulo"; // UTC-3
    const now = localDateTimeToUtc(2026, 11, 25, 11, 15, tz);

    const lateSlots = AvailabilityCalculator.calculateSlotsForCollaborator({
      date: "2026-11-25",
      timezone: tz,
      serviceDurationMinutes: 30,
      now,
      collaborator: { id: "collab-1", name: "Ana" },
      workSchedule: wednesdaySchedule,
      blocks: [],
      activeAppointments: [],
    });

    // Apenas 11:30 está no futuro (> 11:15) e cabe antes de 12:00
    expect(lateSlots.map((s) => s.startsAt.toISOString())).toEqual([
      localDateTimeToUtc(2026, 11, 25, 11, 30, tz).toISOString(),
    ]);

    // Serviço de 120 min não cabe em 09:00-10:30 (90 min) nem em 11:00-12:00 (60 min)
    const tooLongSlots = AvailabilityCalculator.calculateSlotsForCollaborator({
      date: "2026-11-25",
      timezone: tz,
      serviceDurationMinutes: 120,
      now: localDateTimeToUtc(2026, 11, 25, 8, 0, tz),
      collaborator: { id: "collab-1", name: "Ana" },
      workSchedule: wednesdaySchedule,
      blocks: [],
      activeAppointments: [],
    });

    expect(tooLongSlots).toEqual([]);
  });

  it("handles late evening shifts crossing UTC midnight for both Sao_Paulo and Caracas", () => {
    const eveningSchedule: DailyWorkScheduleData = {
      dayOfWeek: 3, // Quarta-feira
      isWorkingDay: true,
      startTime: "20:00",
      endTime: "22:00",
      breakStart: null,
      breakEnd: null,
    };

    for (const tz of ["America/Sao_Paulo", "America/Caracas"] as const) {
      const now = localDateTimeToUtc(2026, 11, 25, 18, 0, tz);
      const targetStart = localDateTimeToUtc(2026, 11, 25, 21, 30, tz);

      // 21:30 local já é dia seguinte em UTC (00:30Z em SP e 01:30Z em Caracas), mas deve validar na quarta-feira!
      const validated = AvailabilityCalculator.validateSlotAvailability({
        startsAt: targetStart,
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: eveningSchedule,
        blocks: [],
        activeAppointments: [],
      });

      expect(validated.startsAt.toISOString()).toBe(targetStart.toISOString());
      expect(validated.endsAt.toISOString()).toBe(
        localDateTimeToUtc(2026, 11, 25, 22, 0, tz).toISOString(),
      );
    }
  });

  it("validateSlotAvailability rejects past, outside schedule, break, blocked, and conflicting times", () => {
    const tz = "America/Caracas";
    const now = localDateTimeToUtc(2026, 11, 25, 9, 0, tz);

    // No passado
    expect(() =>
      AvailabilityCalculator.validateSlotAvailability({
        startsAt: localDateTimeToUtc(2026, 11, 25, 9, 0, tz),
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: wednesdaySchedule,
        blocks: [],
      }),
    ).toThrow(AppointmentInPastError);

    // Fora do expediente (começa no horário de fechamento).
    expect(() =>
      AvailabilityCalculator.validateSlotAvailability({
        startsAt: localDateTimeToUtc(2026, 11, 25, 12, 0, tz),
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: wednesdaySchedule,
        blocks: [],
      }),
    ).toThrow(AppointmentOutsideWorkScheduleError);

    // Começa durante o descanso.
    expect(() =>
      AvailabilityCalculator.validateSlotAvailability({
        startsAt: localDateTimeToUtc(2026, 11, 25, 10, 30, tz),
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: wednesdaySchedule,
        blocks: [],
      }),
    ).toThrow(AppointmentDuringBreakError);

    // Bloqueado por schedule_block
    expect(() =>
      AvailabilityCalculator.validateSlotAvailability({
        startsAt: localDateTimeToUtc(2026, 11, 25, 9, 30, tz),
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: wednesdaySchedule,
        blocks: [
          TimeRange.create(
            localDateTimeToUtc(2026, 11, 25, 9, 45, tz),
            localDateTimeToUtc(2026, 11, 25, 10, 15, tz),
          ),
        ],
      }),
    ).toThrow(AppointmentBlockedError);

    // Conflito com agendamento ativo
    expect(() =>
      AvailabilityCalculator.validateSlotAvailability({
        startsAt: localDateTimeToUtc(2026, 11, 25, 11, 0, tz),
        serviceDurationMinutes: 30,
        timezone: tz,
        now,
        workSchedule: wednesdaySchedule,
        blocks: [],
        activeAppointments: [
          TimeRange.create(
            localDateTimeToUtc(2026, 11, 25, 11, 15, tz),
            localDateTimeToUtc(2026, 11, 25, 11, 45, tz),
          ),
        ],
      }),
    ).toThrow(AppointmentTimeConflictError);
  });
});
