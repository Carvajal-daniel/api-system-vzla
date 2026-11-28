import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../../../Company/infra/database/schema/company-settings-schema.js";
import type {
  AppointmentRemindersRepository,
  PendingReminderAppointment,
  ReminderWindowType,
} from "../../../domain/repositories/appointment-reminders.repository.js";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export class DrizzleAppointmentRemindersRepository
  implements AppointmentRemindersRepository
{
  public async findPendingReminders(params: {
    tenantId?: string | undefined;
    now: Date;
    windowType: ReminderWindowType;
  }): Promise<PendingReminderAppointment[]> {
    // Busca uma janela ampla no SQL e aplica o filtro fino pela preferência configurada
    // em company_settings.preferences.reminders (1h, 2h, 4h ou 24h).
    const minLeadMs = params.windowType === "24H" ? 23 * HOUR_MS : 15 * MINUTE_MS;
    const maxLeadMs =
      params.windowType === "24H" ? 25 * HOUR_MS : 4.5 * HOUR_MS;

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
        companySlug: CompanyTable.slug,
        companyTimezone: CompanyTable.timezone,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
        serviceName: AppointmentTable.serviceNameSnapshot,
        collaboratorName: CollaboratorTable.name,
        startsAt: AppointmentTable.startsAt,
        preferences: CompanySettingsTable.preferences,
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
      .leftJoin(
        CompanySettingsTable,
        eq(CompanySettingsTable.companyId, AppointmentTable.companyId),
      )
      .where(and(...conditions));

    const matched: PendingReminderAppointment[] = [];
    for (const row of rows) {
      const reminderPref = row.preferences?.reminders ?? null;

      // Se a barbearia desativou explicitamente os lembretes nas configurações, não dispara.
      if (reminderPref && !reminderPref.enabled) {
        continue;
      }

      const leadMs = row.startsAt.getTime() - params.now.getTime();
      if (params.windowType === "24H") {
        // Se configurado para outra janela menor (< 24h), não duplica na janela de 24h.
        if (reminderPref && reminderPref.hours !== 24) continue;
        if (leadMs <= 23 * HOUR_MS || leadMs > 25 * HOUR_MS) continue;
      } else {
        // Janela curta: respeita o número de horas configurado (1h, 2h ou 4h); padrão 2h se não configurado.
        if (reminderPref && reminderPref.hours === 24) continue;
        const targetHours = reminderPref?.hours ?? 2;
        const lowerMs = Math.max(15 * MINUTE_MS, (targetHours - 0.5) * HOUR_MS);
        const upperMs = (targetHours + 0.5) * HOUR_MS;
        if (leadMs <= lowerMs || leadMs > upperMs) continue;
      }

      matched.push({
        appointmentId: row.appointmentId,
        companyId: row.companyId,
        companyName: row.companyName,
        companySlug: row.companySlug,
        companyTimezone: row.companyTimezone,
        clientName: row.clientName,
        clientPhone: row.clientPhone,
        serviceName: row.serviceName,
        collaboratorName: row.collaboratorName,
        startsAt: row.startsAt,
        reminderSettings: reminderPref
          ? {
              enabled: reminderPref.enabled,
              hours: reminderPref.hours,
              template: reminderPref.template,
              message: reminderPref.message,
              externalUrl: reminderPref.externalUrl,
            }
          : null,
      });
    }

    return matched;
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
