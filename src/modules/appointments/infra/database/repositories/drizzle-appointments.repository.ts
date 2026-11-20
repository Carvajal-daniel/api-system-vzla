import { and, asc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { Appointment } from "../../../domain/entities/appointment.entity.js";
import { AppointmentTimeConflictError } from "../../../domain/errors/appointment-errors.js";
import type {
  AppointmentsRepository,
  ListAppointmentsFilter,
} from "../../../domain/repositories/appointments.repository.js";
import type { AppointmentStatusValue } from "../../../domain/value-objects/appointment-status.vo.js";
import { AppointmentTable } from "../schema/appointments-schema.js";

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
    serviceNameSnapshot: row.serviceNameSnapshot,
    servicePriceInCentsSnapshot: row.servicePriceInCentsSnapshot,
    serviceDurationMinutesSnapshot: row.serviceDurationMinutesSnapshot,
    commissionPercentageSnapshot: Number(row.commissionPercentageSnapshot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleAppointmentsRepository implements AppointmentsRepository {
  async createWithLock(appointment: Appointment): Promise<void> {
    const lockKey = `${appointment.companyId}:${appointment.collaboratorId}`;

    await db.transaction(async (tx) => {
      // Adquire lock transacional exclusivo por (companyId, collaboratorId) para impedir double-booking concorrente.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      const conflicts = await tx
        .select({ id: AppointmentTable.id })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, appointment.companyId),
            eq(AppointmentTable.collaboratorId, appointment.collaboratorId),
            inArray(AppointmentTable.status, [...ACTIVE_BOOKING_STATUSES]),
            lt(AppointmentTable.startsAt, appointment.endsAt),
            gt(AppointmentTable.endsAt, appointment.startsAt),
          ),
        )
        .limit(1);

      if (conflicts.length > 0) {
        throw new AppointmentTimeConflictError();
      }

      await tx.insert(AppointmentTable).values({
        id: appointment.id,
        companyId: appointment.companyId,
        collaboratorId: appointment.collaboratorId,
        serviceId: appointment.serviceId,
        clientName: appointment.clientName,
        clientPhone: appointment.clientPhone,
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        status: appointment.status,
        cancellationReason: appointment.cancellationReason,
        serviceNameSnapshot: appointment.serviceNameSnapshot,
        servicePriceInCentsSnapshot: appointment.servicePriceInCentsSnapshot,
        serviceDurationMinutesSnapshot:
          appointment.serviceDurationMinutesSnapshot,
        commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
        createdAt: appointment.createdAt,
        updatedAt: appointment.updatedAt,
      });
    });
  }

  async rescheduleWithLock(appointment: Appointment): Promise<void> {
    const lockKey = `${appointment.companyId}:${appointment.collaboratorId}`;

    await db.transaction(async (tx) => {
      // Lock transacional no colaborador de destino antes de verificar sobreposição (ignorando o próprio ID).
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

      const conflicts = await tx
        .select({ id: AppointmentTable.id })
        .from(AppointmentTable)
        .where(
          and(
            ne(AppointmentTable.id, appointment.id),
            eq(AppointmentTable.companyId, appointment.companyId),
            eq(AppointmentTable.collaboratorId, appointment.collaboratorId),
            inArray(AppointmentTable.status, [...ACTIVE_BOOKING_STATUSES]),
            lt(AppointmentTable.startsAt, appointment.endsAt),
            gt(AppointmentTable.endsAt, appointment.startsAt),
          ),
        )
        .limit(1);

      if (conflicts.length > 0) {
        throw new AppointmentTimeConflictError();
      }

      await tx
        .update(AppointmentTable)
        .set({
          collaboratorId: appointment.collaboratorId,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          updatedAt: appointment.updatedAt,
        })
        .where(
          and(
            eq(AppointmentTable.companyId, appointment.companyId),
            eq(AppointmentTable.id, appointment.id),
          ),
        );
    });
  }

  async save(appointment: Appointment): Promise<void> {
    await db
      .update(AppointmentTable)
      .set({
        status: appointment.status,
        cancellationReason: appointment.cancellationReason,
        updatedAt: appointment.updatedAt,
      })
      .where(
        and(
          eq(AppointmentTable.companyId, appointment.companyId),
          eq(AppointmentTable.id, appointment.id),
        ),
      );
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
