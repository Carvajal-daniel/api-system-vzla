import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { Appointment } from "../../../domain/entities/appointment.entity.js";
import {
  AppointmentChangedError,
  AppointmentRevertNotAllowedError,
  AppointmentTimeConflictError,
} from "../../../domain/errors/appointment-errors.js";
import type {
  AppointmentAuditLogRecord,
  BookingPolicyOptions,
  AppointmentsRepository,
  CreateAppointmentAuditLogInput,
  ListAppointmentsFilter,
  PublicBookingDetails,
} from "../../../domain/repositories/appointments.repository.js";
import type { AppointmentStatusValue } from "../../../domain/value-objects/appointment-status.vo.js";
import {
  FinancialDocumentTable,
  ReceiptTable,
} from "../../../../finance/infra/database/schema/collections-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import {
  AppointmentAuditLogTable,
  AppointmentTable,
} from "../schema/appointments-schema.js";

import { AppointmentPolicyService } from "../../../domain/services/appointment-policy.service.js";
import { recordSaasTelemetry } from "../../../../billing/infra/database/repositories/drizzle-saas-telemetry.repository.js";
import { ClubSubscriptionTable, SubscriptionPlanTable } from "../schema/subscription-plans-schema.js";

const ACTIVE_BOOKING_STATUSES: readonly AppointmentStatusValue[] = [
  "PENDING",
  "CONFIRMED",
];

function mapRowToEntity(
  row: typeof AppointmentTable.$inferSelect,
): Appointment {
  return Appointment.restore({
    id: row.id,
    companyId: row.companyId,
    collaboratorId: row.collaboratorId,
    serviceId: row.serviceId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status as AppointmentStatusValue,
    cancellationReason: row.cancellationReason,
    notes: row.notes,
    isGuest: row.isGuest,
    usesClubBenefit: row.usesClubBenefit,
    serviceNameSnapshot: row.serviceNameSnapshot,
    servicePriceInCentsSnapshot: row.servicePriceInCentsSnapshot,
    serviceDurationMinutesSnapshot: row.serviceDurationMinutesSnapshot,
    commissionPercentageSnapshot: Number(row.commissionPercentageSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockClient(tx: Transaction, appointment: Appointment) {
  const key = `appointment-client:${appointment.companyId}:${appointment.clientPhone}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

async function acquireSlotLock(tx: Transaction, appointment: Appointment) {
  const key = `${appointment.companyId}:${appointment.collaboratorId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}

async function assertSlotFree(tx: Transaction, appointment: Appointment, exceptId?: string) {
  const [conflict] = await tx.select({ id: AppointmentTable.id }).from(AppointmentTable).where(and(
    eq(AppointmentTable.companyId, appointment.companyId),
    eq(AppointmentTable.collaboratorId, appointment.collaboratorId),
    inArray(AppointmentTable.status, [...ACTIVE_BOOKING_STATUSES]),
    lt(AppointmentTable.startsAt, appointment.endsAt),
    gt(AppointmentTable.endsAt, appointment.startsAt),
    exceptId ? ne(AppointmentTable.id, exceptId) : undefined,
  )).limit(1);
  if (conflict) throw new AppointmentTimeConflictError();
}

async function findMembership(tx: Transaction, appointment: Appointment) {
  const [membership] = await tx.select({
    status: ClubSubscriptionTable.status,
    dueAt: ClubSubscriptionTable.dueAt,
    allowedDaysOfWeek: SubscriptionPlanTable.allowedDaysOfWeek,
    gracePeriodDays: SubscriptionPlanTable.gracePeriodDays,
  }).from(ClubSubscriptionTable).innerJoin(SubscriptionPlanTable, and(
    eq(SubscriptionPlanTable.companyId, ClubSubscriptionTable.companyId),
    eq(SubscriptionPlanTable.id, ClubSubscriptionTable.planId),
  )).where(and(
    eq(ClubSubscriptionTable.companyId, appointment.companyId),
    eq(ClubSubscriptionTable.clientPhone, appointment.clientPhone),
  )).for("share");
  return membership;
}

async function recordBooking(tx: Transaction, companyId: string, policy: BookingPolicyOptions) {
  const key = `club-snapshot:${companyId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
  const [{ activeClubSubscribers } = { activeClubSubscribers: 0 }] = await tx
    .select({ activeClubSubscribers: count() }).from(ClubSubscriptionTable)
    .where(and(eq(ClubSubscriptionTable.companyId, companyId), eq(ClubSubscriptionTable.status, "ACTIVE")));
  await recordSaasTelemetry(tx, companyId, policy.now, {
    activeClubSubscribers,
    ...(policy.ai ? { appointmentsCreatedByAi: 1 } : { appointmentsCreatedManual: 1 }),
  });
}

function rethrowSlotConflict(error: unknown): never {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  if (typeof cause === "object" && cause !== null && "constraint" in cause &&
      cause.constraint === "appointments_active_slot_exclusion") {
    throw new AppointmentTimeConflictError();
  }
  throw error;
}

export class DrizzleAppointmentsRepository implements AppointmentsRepository {
  async createWithLock(
    appointment: Appointment,
    details?: PublicBookingDetails,
    policy?: BookingPolicyOptions,
  ): Promise<Appointment> {
    return db.transaction(async (tx) => {
      const isGuest = policy?.isGuest ?? false;
      let usesClubBenefit = false;
      if (policy && !isGuest) {
        await lockClient(tx, appointment);
        const membership = await findMembership(tx, appointment);
        const [existing] = membership?.status === "ACTIVE" ? await tx.select().from(AppointmentTable).where(and(
          eq(AppointmentTable.companyId, appointment.companyId),
          eq(AppointmentTable.clientPhone, appointment.clientPhone),
          eq(AppointmentTable.isGuest, false),
          inArray(AppointmentTable.status, [...ACTIVE_BOOKING_STATUSES]),
          gt(AppointmentTable.startsAt, new Date(Math.max(Date.now(), policy.now.getTime()))),
        )).orderBy(asc(AppointmentTable.startsAt)).limit(1) : [];

        usesClubBenefit = AppointmentPolicyService.evaluate({
          membership,
          dayOfWeek: policy.dayOfWeek,
          now: policy.now,
          isGuest,
          payFullPrice: policy.payFullPrice ?? false,
          ...(existing ? { existing: {
            id: existing.id,
            startsAt: existing.startsAt.toISOString(),
            endsAt: existing.endsAt.toISOString(),
            serviceId: existing.serviceId,
            serviceName: existing.serviceNameSnapshot,
            collaboratorId: existing.collaboratorId,
            status: existing.status,
          } } : {}),
        });
      }

      await acquireSlotLock(tx, appointment);
      await assertSlotFree(tx, appointment);
      const [saved] = await tx.insert(AppointmentTable).values({
        id: appointment.id,
        companyId: appointment.companyId,
        collaboratorId: appointment.collaboratorId,
        serviceId: appointment.serviceId,
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        clientData: details?.clientData ?? null,
        cancellationDigest: details?.cancellationDigest ?? null,
        isGuest,
        usesClubBenefit,
        clubFullPriceInCents: usesClubBenefit ? appointment.servicePriceInCentsSnapshot : null,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        cancellationReason: appointment.cancellationReason,
        notes: appointment.notes,
        serviceNameSnapshot: appointment.serviceNameSnapshot,
        servicePriceInCentsSnapshot: usesClubBenefit ? 0 : appointment.servicePriceInCentsSnapshot,
        serviceDurationMinutesSnapshot: appointment.serviceDurationMinutesSnapshot,
        commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      }).returning();
      if (policy) await recordBooking(tx, appointment.companyId, policy);
      return mapRowToEntity(saved!);
    }).catch(rethrowSlotConflict);
  }

  async rescheduleWithLock(appointment: Appointment, policy?: BookingPolicyOptions): Promise<Appointment> {
    return db.transaction(async (tx) => {
      await lockClient(tx, appointment);
      // Take the destination slot lock before locking the source row, as for booking creation.
      await acquireSlotLock(tx, appointment);

      const identity = and(eq(AppointmentTable.companyId, appointment.companyId), eq(AppointmentTable.id, appointment.id));
      const [source] = await tx.select().from(AppointmentTable).where(identity).for("update");
      const expected = policy?.expected;
      if (!source || !ACTIVE_BOOKING_STATUSES.some((status) => status === source.status) ||
          (expected && (source.status !== expected.status ||
            source.collaboratorId !== expected.collaboratorId ||
            source.startsAt.getTime() !== expected.startsAt.getTime()))) {
        throw new AppointmentChangedError();
      }

      if (policy?.ai) AppointmentPolicyService.assertAiCanChange(source.startsAt, new Date(Math.max(Date.now(), policy.now.getTime())));
      const membership = policy && !source.isGuest ? await findMembership(tx, appointment) : undefined;
      const swap = Boolean(policy?.ai && membership?.status === "ACTIVE");

      const usesClubBenefit = policy && source.usesClubBenefit
        ? AppointmentPolicyService.evaluate({
            membership, now: policy.now, dayOfWeek: policy.dayOfWeek,
            isGuest: source.isGuest, payFullPrice: policy.payFullPrice ?? false,
          })
        : source.usesClubBenefit;
      const price = usesClubBenefit ? 0 : source.clubFullPriceInCents ?? source.servicePriceInCentsSnapshot;
      const changes = {
        collaboratorId: appointment.collaboratorId,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
        usesClubBenefit,
        clubFullPriceInCents: usesClubBenefit ? source.clubFullPriceInCents : null,
        servicePriceInCentsSnapshot: price,
        updatedAt: appointment.updatedAt,
      };

      if (swap && policy) {
        await tx.update(AppointmentTable).set({
          status: "CANCELED",
          cancellationReason: "Remarcado via WhatsApp IA.",
          updatedAt: appointment.updatedAt,
        }).where(identity);
        await assertSlotFree(tx, appointment, source.id);
        const [replacement] = await tx.insert(AppointmentTable).values({
          ...source,
          ...changes,
          id: randomUUID(),
          createdAt: appointment.updatedAt,
          cancellationDigest: null,
          reminder24hSentAt: null,
          reminder2hSentAt: null,
          npsSentAt: null,
          npsRespondedAt: null,
        }).returning();
        await recordBooking(tx, appointment.companyId, policy);
        return mapRowToEntity(replacement!);
      }

      await assertSlotFree(tx, appointment, source.id);
      const [updated] = await tx.update(AppointmentTable).set(changes).where(identity).returning();
      return mapRowToEntity(updated!);
    }).catch(rethrowSlotConflict);
  }

  async save(
    appointment: Appointment,
    expected: Pick<Appointment, "status" | "startsAt" | "collaboratorId">,
    aiNow?: Date,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (aiNow) {
        const [source] = await tx.select({ startsAt: AppointmentTable.startsAt }).from(AppointmentTable)
          .where(and(eq(AppointmentTable.companyId, appointment.companyId), eq(AppointmentTable.id, appointment.id))).for("update");
        if (!source) throw new AppointmentChangedError();
        AppointmentPolicyService.assertAiCanChange(source.startsAt, new Date(Math.max(Date.now(), aiNow.getTime())));
      }
      const completedAt = appointment.status === "COMPLETED" ? appointment.updatedAt : null;
      const [company] = completedAt
        ? await tx.select({ currency: CompanyTable.currency }).from(CompanyTable)
          .where(eq(CompanyTable.id, appointment.companyId)).for("update")
        : [];
      const updated = await tx.update(AppointmentTable)
        .set({
          status: appointment.status,
          completedAt,
          cancellationReason: appointment.cancellationReason,
          updatedAt: appointment.updatedAt,
        })
        .where(and(
          eq(AppointmentTable.companyId, appointment.companyId),
          eq(AppointmentTable.id, appointment.id),
          eq(AppointmentTable.status, expected.status),
          eq(AppointmentTable.startsAt, expected.startsAt),
          eq(AppointmentTable.collaboratorId, expected.collaboratorId),
        )).returning({ id: AppointmentTable.id });
      if (!updated.length) throw new AppointmentChangedError();

      if (completedAt && company) {
        const netInCents = appointment.servicePriceInCentsSnapshot;
        const generatedCommissionInCents = Math.round(netInCents * appointment.commissionPercentageSnapshot / 100);
        await tx.insert(FinancialDocumentTable).values({
          companyId: appointment.companyId,
          appointmentId: appointment.id,
          currency: company.currency,
          netInCents,
          generatedCommissionInCents,
        }).onConflictDoUpdate({
          target: [FinancialDocumentTable.companyId, FinancialDocumentTable.appointmentId],
          set: { generatedCommissionInCents },
        });
      }
    });
  }

  async revertCompletionWithAudit(
    appointment: Appointment,
    expected: Pick<Appointment, "status" | "startsAt" | "collaboratorId">,
    audit: CreateAppointmentAuditLogInput,
  ): Promise<AppointmentAuditLogRecord> {
    return db.transaction(async (tx) => {
      // Impede reversão se houver recebimentos líquidos ativos para não corromper o caixa ou comissões.
      const [doc] = await tx
        .select({ id: FinancialDocumentTable.id })
        .from(FinancialDocumentTable)
        .where(
          and(
            eq(FinancialDocumentTable.companyId, appointment.companyId),
            eq(FinancialDocumentTable.appointmentId, appointment.id),
          ),
        )
        .limit(1);

      if (doc) {
        const receipts = await tx
          .select({
            amountInCents: ReceiptTable.amountInCents,
            reversesReceiptId: ReceiptTable.reversesReceiptId,
          })
          .from(ReceiptTable)
          .where(
            and(
              eq(ReceiptTable.companyId, appointment.companyId),
              eq(ReceiptTable.documentId, doc.id),
            ),
          );

        const netCollected = receipts.reduce(
          (sum, row) => sum + (row.reversesReceiptId ? -row.amountInCents : row.amountInCents),
          0,
        );
        if (netCollected > 0) {
          throw new AppointmentRevertNotAllowedError("APPOINTMENT_HAS_PAID_RECEIPTS");
        }
      }

      const updated = await tx
        .update(AppointmentTable)
        .set({
          status: appointment.status,
          completedAt: null,
          updatedAt: appointment.updatedAt,
        })
        .where(
          and(
            eq(AppointmentTable.companyId, appointment.companyId),
            eq(AppointmentTable.id, appointment.id),
            eq(AppointmentTable.status, expected.status),
            eq(AppointmentTable.startsAt, expected.startsAt),
            eq(AppointmentTable.collaboratorId, expected.collaboratorId),
          ),
        )
        .returning({ id: AppointmentTable.id });

      if (!updated.length) {
        throw new AppointmentChangedError();
      }

      const [inserted] = await tx
        .insert(AppointmentAuditLogTable)
        .values({
          companyId: appointment.companyId,
          appointmentId: appointment.id,
          action: audit.action,
          previousStatus: audit.previousStatus,
          newStatus: audit.newStatus,
          reason: audit.reason,
          authorizedById: audit.authorizedById,
          authorizedByName: audit.authorizedByName,
          authorizedByRole: audit.authorizedByRole,
        })
        .returning();

      return {
        id: inserted!.id,
        companyId: inserted!.companyId,
        appointmentId: inserted!.appointmentId,
        action: inserted!.action,
        previousStatus: inserted!.previousStatus as AppointmentStatusValue,
        newStatus: inserted!.newStatus as AppointmentStatusValue,
        reason: inserted!.reason,
        authorizedById: inserted!.authorizedById,
        authorizedByName: inserted!.authorizedByName,
        authorizedByRole: inserted!.authorizedByRole,
        createdAt: inserted!.createdAt,
      };
    }).catch(rethrowSlotConflict);
  }

  async listAuditLogs(
    companyId: string,
    appointmentId: string,
  ): Promise<AppointmentAuditLogRecord[]> {
    const rows = await db
      .select()
      .from(AppointmentAuditLogTable)
      .where(
        and(
          eq(AppointmentAuditLogTable.companyId, companyId),
          eq(AppointmentAuditLogTable.appointmentId, appointmentId),
        ),
      )
      .orderBy(desc(AppointmentAuditLogTable.createdAt));

    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      appointmentId: row.appointmentId,
      action: row.action,
      previousStatus: row.previousStatus as AppointmentStatusValue,
      newStatus: row.newStatus as AppointmentStatusValue,
      reason: row.reason,
      authorizedById: row.authorizedById,
      authorizedByName: row.authorizedByName,
      authorizedByRole: row.authorizedByRole,
      createdAt: row.createdAt,
    }));
  }

  async findById(
    companyId: string,
    appointmentId: string,
  ): Promise<Appointment | null> {
    const rows = await db
      .select()
      .from(AppointmentTable)
      .where(
        and(
          eq(AppointmentTable.companyId, companyId),
          eq(AppointmentTable.id, appointmentId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? mapRowToEntity(row) : null;
  }

  async list(filter: ListAppointmentsFilter): Promise<Appointment[]> {
    const conditions = [eq(AppointmentTable.companyId, filter.companyId)];

    if (filter.collaboratorId !== undefined) {
      conditions.push(
        eq(AppointmentTable.collaboratorId, filter.collaboratorId),
      );
    }
    if (filter.status !== undefined) {
      conditions.push(eq(AppointmentTable.status, filter.status));
    }
    if (filter.from !== undefined) {
      conditions.push(gt(AppointmentTable.endsAt, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lt(AppointmentTable.startsAt, filter.to));
    }

    const rows = await db
      .select()
      .from(AppointmentTable)
      .where(and(...conditions))
      .orderBy(asc(AppointmentTable.startsAt));

    return rows.map(mapRowToEntity);
  }

  async findActiveOverlapping(
    companyId: string,
    rangeStart: Date,
    rangeEnd: Date,
    collaboratorId?: string | null,
  ): Promise<Appointment[]> {
    const conditions = [
      eq(AppointmentTable.companyId, companyId),
      inArray(AppointmentTable.status, [...ACTIVE_BOOKING_STATUSES]),
      lt(AppointmentTable.startsAt, rangeEnd),
      gt(AppointmentTable.endsAt, rangeStart),
    ];

    if (collaboratorId !== undefined && collaboratorId !== null) {
      conditions.push(eq(AppointmentTable.collaboratorId, collaboratorId));
    }

    const rows = await db
      .select()
      .from(AppointmentTable)
      .where(and(...conditions))
      .orderBy(asc(AppointmentTable.startsAt));

    return rows.map(mapRowToEntity);
  }
}
