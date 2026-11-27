import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { ServiceTable } from "../../../../services/infra/database/schema/services-schema.js";
import { SaasTelemetryTable } from "../../../../billing/infra/database/schema/saas-telemetry-schema.js";
import { DrizzleTenantUsageRepository } from "../../../../billing/infra/database/repositories/drizzle-tenant-usage.repository.js";
import { FinanceOrderTable } from "../../../../finance/infra/database/schema/orders-schema.js";
import { ListAppointmentsUseCase } from "../../../application/use-cases/list-appointments.use-case.js";
import { UpdateAppointmentStatusUseCase } from "../../../application/use-cases/update-appointment-status.use-case.js";
import { Appointment } from "../../../domain/entities/appointment.entity.js";
import { AppointmentTable } from "../schema/appointments-schema.js";
import { ClubSubscriptionTable, SubscriptionPlanTable } from "../schema/subscription-plans-schema.js";
import { DrizzleAppointmentsRepository } from "./drizzle-appointments.repository.js";

vi.mock("../../../../../shared/database/database.js", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.PHASE_1_TEST_DATABASE_URL });
  return { db: drizzle({ client: pool }) };
});

// The URL must point to a disposable database with the repository migrations applied.
describe.skipIf(!process.env.PHASE_1_TEST_DATABASE_URL)("Phase 1 on PostgreSQL", () => {
  const repository = new DrizzleAppointmentsRepository();
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const policy = { now, ai: true, dayOfWeek: 1 };
  const phone = "+5511912345678";
  const otherPhone = "+5511987654321";
  let companyId: string;
  let collaboratorIds: [string, string];
  let serviceId: string;

  beforeEach(async () => {
    companyId = randomUUID();
    collaboratorIds = [randomUUID(), randomUUID()];
    serviceId = randomUUID();
    await db.insert(CompanyTable).values({
      id: companyId, companyName: "Phase 1 test", slug: `phase-1-${companyId.slice(0, 8)}`, name: "Owner", phone,
      email: `${companyId}@example.test`, password: "fixture", timezone: "UTC",
    });
    await db.insert(CollaboratorTable).values(collaboratorIds.map((id) => ({
      id, companyId, name: "Professional", specialty: "Corte", commissionPercentage: 30,
      email: `${id}@example.test`, phone, password: "fixture",
    })));
    await db.insert(ServiceTable).values({
      id: serviceId, companyId, name: "Corte", priceInCents: 5000, durationMinutes: 30,
    });
  });

  afterEach(async () => {
    await db.delete(FinanceOrderTable).where(eq(FinanceOrderTable.companyId, companyId));
    await db.delete(AppointmentTable).where(eq(AppointmentTable.companyId, companyId));
    await db.delete(CollaboratorTable).where(eq(CollaboratorTable.companyId, companyId));
    await db.delete(CompanyTable).where(eq(CompanyTable.id, companyId));
  });

  afterAll(async () => { await db.$client.end(); });

  async function enroll(allowedDaysOfWeek: number[] | null = null) {
    const [plan] = await db.insert(SubscriptionPlanTable).values({
      companyId, name: "Clube", allowedDaysOfWeek,
    }).returning();
    await db.insert(ClubSubscriptionTable).values({
      companyId, clientPhone: phone, planId: plan!.id, status: "ACTIVE",
    });
  }

  function appointment(minutes: number, clientPhone = phone, collaboratorId = collaboratorIds[0]) {
    return Appointment.create({
      companyId, collaboratorId, serviceId, clientPhone, clientName: "Cliente Teste",
      startsAt: new Date(now.getTime() + minutes * 60_000), initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Corte", servicePriceInCentsSnapshot: 5000, serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 30,
    });
  }

  it("serializes concurrent bookings by the same subscriber across professionals", async () => {
    await enroll();
    const pending = await Promise.allSettled([
      repository.createWithLock(appointment(120), undefined, policy),
      repository.createWithLock(appointment(180, phone, collaboratorIds[1]), undefined, policy),
    ]);
    const created = pending.find((result) => result.status === "fulfilled")?.value;
    const rejected = pending.find((result) => result.status === "rejected")?.reason;
    expect(created?.servicePriceInCentsSnapshot).toBe(0);
    expect(rejected).toMatchObject({
      reasonCode: "SUBSCRIBER_ACTIVE_APPOINTMENT_EXISTS",
      currentAppointment: { id: created?.id },
    });
    expect(await repository.list({ companyId })).toHaveLength(1);
  });

  it("rolls back the cancellation on slot conflict and replaces the booking atomically after retry", async () => {
    await enroll();
    const original = await repository.createWithLock(appointment(120), undefined, policy);
    await repository.createWithLock(appointment(240, otherPhone), undefined, { ...policy, ai: false });
    original.reschedule(appointment(240).startsAt);
    await expect(repository.rescheduleWithLock(original, policy)).rejects.toMatchObject({ name: "AppointmentTimeConflictError" });
    expect((await repository.findById(companyId, original.id))?.status).toBe("CONFIRMED");
    expect(await repository.list({ companyId })).toHaveLength(2);

    original.reschedule(appointment(300).startsAt);
    const replacement = await repository.rescheduleWithLock(original, policy);
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.status).toBe("CONFIRMED");
    expect((await repository.findById(companyId, original.id))?.status).toBe("CANCELED");
    expect(await db.select().from(SaasTelemetryTable).where(eq(SaasTelemetryTable.companyId, companyId)))
      .toEqual([expect.objectContaining({ appointmentsCreatedByAi: 2, appointmentsCreatedManual: 1 })]);
  });

  it("returns the day restriction, accepts an explicit full-price booking, and keeps guests at full price", async () => {
    await enroll([2]);
    await expect(repository.createWithLock(appointment(120), undefined, policy))
      .rejects.toMatchObject({ reasonCode: "PLAN_DAY_RESTRICTED" });
    const guest = await repository.createWithLock(appointment(120), undefined, { ...policy, isGuest: true });
    const paid = await repository.createWithLock(appointment(180), undefined, { ...policy, payFullPrice: true });
    expect([guest.servicePriceInCentsSnapshot, paid.servicePriceInCentsSnapshot]).toEqual([5000, 5000]);
    const rows = await db.select().from(AppointmentTable).where(eq(AppointmentTable.companyId, companyId));
    expect(rows.find((row) => row.id === guest.id)).toMatchObject({ isGuest: true, usesClubBenefit: false });
    expect(rows.find((row) => row.id === paid.id)).toMatchObject({ isGuest: false, usesClubBenefit: false });
  });

  it("honors recorded grace days and charges full price when the grace period ends", async () => {
    await enroll();
    await db.update(ClubSubscriptionTable).set({
      status: "PAST_DUE",
      dueAt: new Date(now.getTime() - 2 * 86_400_000),
    }).where(eq(ClubSubscriptionTable.companyId, companyId));
    const inGrace = await repository.createWithLock(appointment(120), undefined, policy);

    await db.update(ClubSubscriptionTable).set({
      status: "SUSPENDED",
      dueAt: new Date(now.getTime() - 3 * 86_400_000),
    }).where(eq(ClubSubscriptionTable.companyId, companyId));
    const afterGrace = await repository.createWithLock(appointment(180), undefined, policy);

    expect([inGrace.usesClubBenefit, afterGrace.usesClubBenefit]).toEqual([true, false]);
    expect(afterGrace.servicePriceInCentsSnapshot).toBe(5000);
  });

  it("rejects simultaneous overlapping slots and accepts an adjacent slot", async () => {
    const competing = await Promise.allSettled([
      repository.createWithLock(appointment(120), undefined, policy),
      repository.createWithLock(appointment(120, otherPhone), undefined, { ...policy, ai: false }),
    ]);
    expect(competing.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const booked = await repository.createWithLock(appointment(150), undefined, policy);
    const [slot] = await db.select().from(AppointmentTable).where(eq(AppointmentTable.id, booked.id));
    await expect(db.insert(AppointmentTable).values({ ...slot!, id: randomUUID() }))
      .rejects.toMatchObject({ cause: { constraint: "appointments_active_slot_exclusion" } });
  });

  it("blocks AI cancellation and rescheduling after the appointment starts and derives awaitingClosure", async () => {
    const past = await repository.createWithLock(appointment(-35));
    const current = await repository.createWithLock(appointment(-1));
    const actor = { userId: companyId, companyId, role: "OWNER" as const };
    await expect(new UpdateAppointmentStatusUseCase(repository).execute({
      actor, actorSource: "WHATSAPP_AI", appointmentId: current.id, status: "CANCELED", now,
    })).rejects.toMatchObject({ reasonCode: "APPOINTMENT_ALREADY_STARTED" });
    current.reschedule(appointment(120).startsAt);
    await expect(repository.rescheduleWithLock(current, policy))
      .rejects.toMatchObject({ reasonCode: "APPOINTMENT_ALREADY_STARTED" });
    expect(await new ListAppointmentsUseCase(repository).execute({ actor })).toEqual([
      expect.objectContaining({ id: past.id, status: "CONFIRMED", awaitingClosure: true }),
      expect.objectContaining({ id: current.id, status: "CONFIRMED", awaitingClosure: false }),
    ]);
  });

  it("aggregates tokens, turns, bookings, subscribers and net closed-order GMV by tenant and date", async () => {
    await enroll();
    await repository.createWithLock(appointment(120), undefined, policy);
    await repository.createWithLock(appointment(180, otherPhone), undefined, { ...policy, ai: false });
    const usage = new DrizzleTenantUsageRepository();
    const usageParams = {
      tenantId: companyId, now, periodMonth: day.slice(0, 7), aiSessionsDelta: 0, outboundMessagesDelta: 0,
      promptTokens: 12, completionTokens: 4, metadata: null,
    };
    await Promise.all([
      usage.incrementUsageAndLog({ ...usageParams, feature: "BOOKING", model: "SIMULATED", promptTokens: 0, completionTokens: 0 }),
      usage.incrementUsageAndLog({ ...usageParams, feature: "BOOKING", model: "gemini" }),
      usage.incrementUsageAndLog({ ...usageParams, feature: "COPILOT", model: "gemini" }),
    ]);
    const order = { id: randomUUID(), companyId, code: "PHASE1", orderDate: day, status: "CLOSED" as const,
      subtotalCents: 6500, totalCents: 6500 };
    await db.insert(FinanceOrderTable).values(order);
    const read = () => db.select().from(SaasTelemetryTable).where(eq(SaasTelemetryTable.companyId, companyId));

    expect(await read()).toEqual([expect.objectContaining({
      date: day, aiTurnsL0: 1, aiTurnsL1: 1, aiTurnsL2: 1, tokensInput: 24, tokensOutput: 8,
      appointmentsCreatedByAi: 1, appointmentsCreatedManual: 1, activeClubSubscribers: 1, gmvCents: 6500,
    })]);

    await db.update(FinanceOrderTable).set({ status: "OPEN" }).where(eq(FinanceOrderTable.id, order.id));
    await db.update(ClubSubscriptionTable).set({ status: "SUSPENDED" }).where(eq(ClubSubscriptionTable.companyId, companyId));
    expect(await read()).toEqual([expect.objectContaining({ gmvCents: 0, activeClubSubscribers: 0 })]);
  });
});
