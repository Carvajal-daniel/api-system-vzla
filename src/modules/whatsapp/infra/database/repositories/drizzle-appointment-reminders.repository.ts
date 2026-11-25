import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import type {
  AppointmentRemindersRepository,
  PendingReminderAppointment,
  ReminderWindowType,
} from "../../../domain/repositories/appointment-reminders.repository.js";

const HOUR_MS = 60 * 60 * 1000;

export class DrizzleAppointmentRemindersRepository
  implements AppointmentRemindersRepository
{
  public async findPendingReminders(params: {
    tenantId?: string | undefined;
    now: Date;
    windowType: ReminderWindowType;
  }): Promise<PendingReminderAppointment[]> {
    const minLeadMs = params.windowType === "24H" ? 23 * HOUR_MS : 1 * HOUR_MS;
    const maxLeadMs =
      params.windowType === "24H" ? 25 * HOUR_MS : 2.5 * HOUR_MS;

    const windowStart = new Date(params.now.getTime() + minLeadMs);
    const windowEnd = new Date(params.now.getTime() + maxLeadMs);

    const conditions = [
      inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
      gt(AppointmentTable.startsAt, windowStart),
      lte(AppointmentTable.startsAt, windowEnd),
      params.windowType === "24H"
        ? isNull(AppointmentTable.reminder24hSentAt)
        : isNull(AppointmentTable.reminder2hSentAt),
      eq(CompanyTable.isActive, true),
    ];

    if (params.tenantId) {
      conditions.push(eq(AppointmentTable.companyId, params.tenantId));
    }

    const rows = await db
      .select({
        appointmentId: AppointmentTable.id,
        companyId: AppointmentTable.companyId,
        companyName: CompanyTable.companyName,
        companyTimezone: CompanyTable.timezone,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
        serviceName: AppointmentTable.serviceNameSnapshot,
        collaboratorName: CollaboratorTable.name,
        startsAt: AppointmentTable.startsAt,
      })
      .from(AppointmentTable)
      .innerJoin(CompanyTable, eq(AppointmentTable.companyId, CompanyTable.id))
      .innerJoin(
        CollaboratorTable,
        and(
          eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
          eq(AppointmentTable.companyId, CollaboratorTable.companyId),
        ),
      )
      .where(and(...conditions));

    return rows;
  }

  public async markReminderSent(params: {
    companyId: string;
    appointmentId: string;
    windowType: ReminderWindowType;
    sentAt: Date;
  }): Promise<boolean> {
    // Atualização condicional atômica garante idempotência mesmo sob execuções concorrentes do job.
    const [updated] = await db
      .update(AppointmentTable)
      .set(
        params.windowType === "24H"
          ? { reminder24hSentAt: params.sentAt, updatedAt: params.sentAt }
          : { reminder2hSentAt: params.sentAt, updatedAt: params.sentAt },
      )
      .where(
        and(
          eq(AppointmentTable.companyId, params.companyId),
          eq(AppointmentTable.id, params.appointmentId),
          params.windowType === "24H"
            ? isNull(AppointmentTable.reminder24hSentAt)
            : isNull(AppointmentTable.reminder2hSentAt),
        ),
      )
      .returning({ id: AppointmentTable.id });

    return Boolean(updated);
  }
}
