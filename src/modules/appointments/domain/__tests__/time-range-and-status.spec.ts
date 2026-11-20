import { describe, expect, it } from "vitest";
import { InvalidPhoneError, Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { Appointment } from "../entities/appointment.entity.js";
import {
  AppointmentNotReschedulableError,
  InvalidAppointmentStatusTransitionError,
  InvalidLocalDateError,
  InvalidTimeRangeError,
  InvalidTimeZoneError,
} from "../errors/appointment-errors.js";
import {
  assertValidIanaTimeZone,
  getLocalDateTimeParts,
  getLocalDayUtcBounds,
  isValidIanaTimeZone,
  localDateTimeToUtc,
} from "../services/timezone-utils.js";
import { AppointmentStatus } from "../value-objects/appointment-status.vo.js";
import { TimeRange } from "../value-objects/time-range.vo.js";

describe("TimeRange Value Object", () => {
  it("rejects inverted or zero-length ranges", () => {
    const start = new Date("2026-11-25T14:00:00.000Z");

    expect(() => TimeRange.create(start, start)).toThrow(InvalidTimeRangeError);
    expect(() =>
      TimeRange.create(start, new Date("2026-11-25T13:59:59.000Z")),
    ).toThrow(InvalidTimeRangeError);
  });

  it("detects strict overlap and allows adjacent intervals", () => {
    const first = TimeRange.create(
      new Date("2026-11-25T12:00:00.000Z"),
      new Date("2026-11-25T12:45:00.000Z"),
    );
    const adjacent = TimeRange.create(
      new Date("2026-11-25T12:45:00.000Z"),
      new Date("2026-11-25T13:30:00.000Z"),
    );
    const overlapping = TimeRange.create(
      new Date("2026-11-25T12:30:00.000Z"),
      new Date("2026-11-25T13:15:00.000Z"),
    );

    expect(first.overlaps(adjacent)).toBe(false);
    expect(adjacent.overlaps(first)).toBe(false);
    expect(first.overlaps(overlapping)).toBe(true);
    expect(overlapping.overlaps(first)).toBe(true);
  });
});

describe("AppointmentStatus State Machine", () => {
  it("allows valid transitions from PENDING and CONFIRMED", () => {
    const pending = AppointmentStatus.create("PENDING");
    expect(pending.blocksAvailability()).toBe(true);
    expect(pending.transitionTo("CONFIRMED").value).toBe("CONFIRMED");
    expect(pending.transitionTo("CANCELED").value).toBe("CANCELED");

    const confirmed = AppointmentStatus.create("CONFIRMED");
    expect(confirmed.blocksAvailability()).toBe(true);
    expect(confirmed.transitionTo("COMPLETED").value).toBe("COMPLETED");
    expect(confirmed.transitionTo("CANCELED").value).toBe("CANCELED");
    expect(confirmed.transitionTo("NO_SHOW").value).toBe("NO_SHOW");
  });

  it("rejects invalid direct transitions and any transition from terminal states", () => {
    const pending = AppointmentStatus.create("PENDING");
    expect(() => pending.transitionTo("COMPLETED")).toThrow(
      InvalidAppointmentStatusTransitionError,
    );
    expect(() => pending.transitionTo("NO_SHOW")).toThrow(
      InvalidAppointmentStatusTransitionError,
    );

    for (const terminal of ["COMPLETED", "CANCELED", "NO_SHOW"] as const) {
      const status = AppointmentStatus.create(terminal);
      expect(status.isTerminal()).toBe(true);
      expect(status.blocksAvailability()).toBe(false);
      expect(() => status.transitionTo("PENDING")).toThrow(
        InvalidAppointmentStatusTransitionError,
      );
      expect(() => status.transitionTo("CONFIRMED")).toThrow(
        InvalidAppointmentStatusTransitionError,
      );
    }
  });
});

describe("Phone Value Object (Brazil +55, Venezuela +58 and legacy compatibility)", () => {
  it("accepts and normalizes Brazilian (+55) and Venezuelan (+58) E.164 numbers", () => {
    expect(Phone.create("+55 (11) 98765-4321").value).toBe("+5511987654321");
    expect(Phone.create("+55 85 3222-1111").value).toBe("+558532221111");
    expect(Phone.create("+58 414-123-4567").value).toBe("+584141234567");
    expect(Phone.create("+58 (412) 555 6677").value).toBe("+584125556677");
  });

  it("preserves backward compatibility with local numeric formats without plus sign", () => {
    expect(Phone.create("11987654321").value).toBe("11987654321");
    expect(Phone.create("0414 123 4567").value).toBe("04141234567");
  });

  it("rejects invalid lengths and malformed E.164 inputs", () => {
    expect(() => Phone.create("12345")).toThrow(InvalidPhoneError);
    expect(() => Phone.create("+5511999")).toThrow(InvalidPhoneError);
    expect(() => Phone.create("+58414123456789")).toThrow(InvalidPhoneError);
    expect(() => Phone.create("+551198765abcd")).toThrow(InvalidPhoneError);
  });
});

describe("Timezone Utilities (Multi-country: Brazil & Venezuela)", () => {
  it("validates IANA timezones for Brazil, Venezuela, and rejects invalid identifiers", () => {
    expect(isValidIanaTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isValidIanaTimeZone("America/Fortaleza")).toBe(true);
    expect(isValidIanaTimeZone("America/Caracas")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);

    expect(isValidIanaTimeZone("Mars/Phobos")).toBe(false);
    expect(() => assertValidIanaTimeZone("Invalid/Zone")).toThrow(InvalidTimeZoneError);
    expect(() => getLocalDayUtcBounds("2026-02-30", "America/Sao_Paulo")).toThrow(
      InvalidLocalDateError,
    );
  });

  it("keeps 21:30 local in America/Sao_Paulo (UTC-3) on the local dayOfWeek even though UTC is next day 00:30", () => {
    // 2026-11-25 é quarta-feira (dayOfWeek = 3). 21:30 BRT (UTC-3) = 2026-11-26T00:30:00Z (quinta-feira em UTC).
    const utcInstant = localDateTimeToUtc(2026, 11, 25, 21, 30, "America/Sao_Paulo");
    expect(utcInstant.toISOString()).toBe("2026-11-26T00:30:00.000Z");

    const localParts = getLocalDateTimeParts(utcInstant, "America/Sao_Paulo");
    expect(localParts.dateString).toBe("2026-11-25");
    expect(localParts.dayOfWeek).toBe(3); // Quarta-feira, não quinta-feira!
    expect(localParts.hour).toBe(21);
    expect(localParts.minute).toBe(30);
  });

  it("keeps 21:30 local in America/Caracas (UTC-4) on the local dayOfWeek even though UTC is next day 01:30", () => {
    // 2026-11-25 é quarta-feira (dayOfWeek = 3). 21:30 VET (UTC-4) = 2026-11-26T01:30:00Z (quinta-feira em UTC).
    const utcInstant = localDateTimeToUtc(2026, 11, 25, 21, 30, "America/Caracas");
    expect(utcInstant.toISOString()).toBe("2026-11-26T01:30:00.000Z");

    const localParts = getLocalDateTimeParts(utcInstant, "America/Caracas");
    expect(localParts.dateString).toBe("2026-11-25");
    expect(localParts.dayOfWeek).toBe(3); // Quarta-feira, não quinta-feira!
    expect(localParts.hour).toBe(21);
    expect(localParts.minute).toBe(30);
  });

  it("computes exact 24h UTC bounds for a local calendar day in Sao_Paulo and Caracas", () => {
    const spBounds = getLocalDayUtcBounds("2026-11-25", "America/Sao_Paulo");
    expect(spBounds.dayOfWeek).toBe(3);
    expect(spBounds.startUtc.toISOString()).toBe("2026-11-25T03:00:00.000Z");
    expect(spBounds.endUtc.toISOString()).toBe("2026-11-26T03:00:00.000Z");

    const veBounds = getLocalDayUtcBounds("2026-11-25", "America/Caracas");
    expect(veBounds.dayOfWeek).toBe(3);
    expect(veBounds.startUtc.toISOString()).toBe("2026-11-25T04:00:00.000Z");
    expect(veBounds.endUtc.toISOString()).toBe("2026-11-26T04:00:00.000Z");
  });
});

describe("Appointment Entity", () => {
  it("always derives endsAt from startsAt + serviceDurationMinutesSnapshot and preserves snapshots", () => {
    const startsAt = new Date("2026-11-25T15:00:00.000Z");
    const appointment = Appointment.create({
      companyId: "company-1",
      collaboratorId: "collab-1",
      serviceId: "service-1",
      clientName: "  João Silva  ",
      clientPhone: "+55 11 99999-8888",
      startsAt,
      serviceNameSnapshot: "Corte Degradê",
      servicePriceInCentsSnapshot: 4500,
      serviceDurationMinutesSnapshot: 45,
      commissionPercentageSnapshot: 40,
    });

    expect(appointment.clientName).toBe("João Silva");
    expect(appointment.clientPhone).toBe("+5511999998888");
    expect(appointment.status).toBe("PENDING");
    expect(appointment.endsAt.toISOString()).toBe("2026-11-25T15:45:00.000Z");
    expect(appointment.servicePriceInCentsSnapshot).toBe(4500);
    expect(appointment.commissionPercentageSnapshot).toBe(40);
  });

  it("blocks rescheduling terminal appointments", () => {
    const appointment = Appointment.create({
      companyId: "company-1",
      collaboratorId: "collab-1",
      serviceId: "service-1",
      clientName: "María Pérez",
      clientPhone: "+58 414-123-4567",
      startsAt: new Date("2026-11-25T15:00:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Barba",
      servicePriceInCentsSnapshot: 2500,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 35,
    });

    appointment.transitionStatus("COMPLETED");

    expect(() =>
      appointment.reschedule(new Date("2026-11-26T15:00:00.000Z")),
    ).toThrow(AppointmentNotReschedulableError);
  });
});
