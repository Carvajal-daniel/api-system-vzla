import { describe, expect, it } from "vitest";
import { AppointmentPolicyService, type ClubMembershipPolicy } from "../services/appointment-policy.service.js";

const now = new Date("2026-11-27T12:00:00Z");
const active: ClubMembershipPolicy = {
  status: "ACTIVE",
  dueAt: null,
  allowedDaysOfWeek: [1],
  gracePeriodDays: 3,
};
const current = {
  id: "existing",
  startsAt: "2026-11-30T12:00:00Z",
  endsAt: "2026-11-30T12:30:00Z",
  serviceId: "service",
  serviceName: "Corte",
  collaboratorId: "professional",
  status: "CONFIRMED",
};
const booking = { membership: active, now, dayOfWeek: 1, isGuest: false, payFullPrice: false };

describe("AppointmentPolicyService", () => {
  it("returns the existing future appointment even if an active member offers to pay full price", () => {
    expect(() => AppointmentPolicyService.evaluate({ ...booking, existing: current, payFullPrice: true }))
      .toThrow(expect.objectContaining({ reasonCode: "SUBSCRIBER_ACTIVE_APPOINTMENT_EXISTS", currentAppointment: current }));
  });

  it("allows plan benefit only on eligible days, with an explicit full-price option", () => {
    expect(AppointmentPolicyService.evaluate(booking)).toBe(true);
    expect(() => AppointmentPolicyService.evaluate({ ...booking, dayOfWeek: 0 }))
      .toThrow(expect.objectContaining({ reasonCode: "PLAN_DAY_RESTRICTED" }));
    expect(AppointmentPolicyService.evaluate({ ...booking, dayOfWeek: 0, payFullPrice: true })).toBe(false);
    expect(AppointmentPolicyService.evaluate({ ...booking, dayOfWeek: 0, membership: { ...active, allowedDaysOfWeek: null } })).toBe(true);
  });

  it("leaves a guest's booking at full price, independently of the member's booking", () => {
    expect(AppointmentPolicyService.evaluate({ ...booking, existing: current, dayOfWeek: 0, isGuest: true })).toBe(false);
  });

  it.each(["PAST_DUE", "SUSPENDED"] as const)("ends the benefit exactly at the grace limit for %s", (status) => {
    const membership = { ...active, status, dueAt: new Date("2026-11-24T12:00:00Z") };
    expect(AppointmentPolicyService.evaluate({ ...booking, membership, now: new Date(now.getTime() - 1) })).toBe(true);
    expect(AppointmentPolicyService.evaluate({ ...booking, membership })).toBe(false);
    expect(AppointmentPolicyService.evaluate({ ...booking, membership: { ...membership, dueAt: null } })).toBe(false);
  });

  it("forbids AI changes from the instant the appointment begins", () => {
    expect(() => AppointmentPolicyService.assertAiCanChange(new Date(now.getTime() + 1), now)).not.toThrow();
    expect(() => AppointmentPolicyService.assertAiCanChange(now, now))
      .toThrow(expect.objectContaining({ reasonCode: "APPOINTMENT_ALREADY_STARTED" }));
    expect(() => AppointmentPolicyService.assertAiCanChange(new Date(now.getTime() - 1), now)).toThrow();
  });
});
