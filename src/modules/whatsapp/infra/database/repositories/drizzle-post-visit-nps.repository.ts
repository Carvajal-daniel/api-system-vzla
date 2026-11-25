import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorReviewTable } from "../../../../Collaborators/infra/database/schema/collaborator-reviews-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../../../Company/infra/database/schema/company-settings-schema.js";
import type {
  EligibleNpsAppointment,
  PendingNpsAppointment,
  PostVisitNpsRepository,
} from "../../../domain/repositories/post-visit-nps.repository.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

function buildPhoneDigitVariants(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    variants.add(digits.slice(2));
  } else if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    variants.add(`55${digits}`);
  }
  return Array.from(variants);
}

export class DrizzlePostVisitNpsRepository implements PostVisitNpsRepository {
  public async findCompletedEligibleForNps(params: {
    tenantId?: string | undefined;
    now: Date;
  }): Promise<EligibleNpsAppointment[]> {
    // Janela de ~1h após conclusão (entre 50min e 3h atrás) para absorver periodicidade do cron sem atrasar o envio.
    const oldestCompletedAt = new Date(params.now.getTime() - 3 * HOUR_MS);
    const newestCompletedAt = new Date(params.now.getTime() - 50 * MINUTE_MS);

    const conditions = [
      eq(AppointmentTable.status, "COMPLETED"),
      isNotNull(AppointmentTable.completedAt),
      gte(AppointmentTable.completedAt, oldestCompletedAt),
      lte(AppointmentTable.completedAt, newestCompletedAt),
      isNull(AppointmentTable.npsSentAt),
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
        preferences: CompanySettingsTable.preferences,
        collaboratorId: AppointmentTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        serviceName: AppointmentTable.serviceNameSnapshot,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
        completedAt: AppointmentTable.completedAt,
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
        eq(AppointmentTable.companyId, CompanySettingsTable.companyId),
      )
      .where(and(...conditions));

    return rows.map((row) => ({
      appointmentId: row.appointmentId,
      companyId: row.companyId,
      companyName: row.companyName,
      googleMapsUrl: row.preferences?.googleMapsUrl ?? null,
      collaboratorId: row.collaboratorId,
      collaboratorName: row.collaboratorName,
      serviceName: row.serviceName,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      completedAt: row.completedAt!,
    }));
  }

  public async markNpsSent(params: {
    companyId: string;
    appointmentId: string;
    sentAt: Date;
  }): Promise<boolean> {
    const [updated] = await db
      .update(AppointmentTable)
      .set({
        npsSentAt: params.sentAt,
        updatedAt: params.sentAt,
      })
      .where(
        and(
          eq(AppointmentTable.companyId, params.companyId),
          eq(AppointmentTable.id, params.appointmentId),
          isNull(AppointmentTable.npsSentAt),
        ),
      )
      .returning({ id: AppointmentTable.id });

    return Boolean(updated);
  }

  public async findPendingNpsForPhone(params: {
    companyId: string;
    phone: string;
    now: Date;
  }): Promise<PendingNpsAppointment | null> {
    const variants = buildPhoneDigitVariants(params.phone);
    if (variants.length === 0) return null;

    const cutoff = new Date(params.now.getTime() - 48 * HOUR_MS);

    const [row] = await db
      .select({
        appointmentId: AppointmentTable.id,
        companyId: AppointmentTable.companyId,
        companyName: CompanyTable.companyName,
        preferences: CompanySettingsTable.preferences,
        collaboratorId: AppointmentTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        serviceName: AppointmentTable.serviceNameSnapshot,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
        npsSentAt: AppointmentTable.npsSentAt,
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
        eq(AppointmentTable.companyId, CompanySettingsTable.companyId),
      )
      .where(
        and(
          eq(AppointmentTable.companyId, params.companyId),
          eq(AppointmentTable.status, "COMPLETED"),
          isNotNull(AppointmentTable.npsSentAt),
          isNull(AppointmentTable.npsRespondedAt),
          gte(AppointmentTable.npsSentAt, cutoff),
          inArray(
            sql`regexp_replace(${AppointmentTable.clientPhone}, '\\D', '', 'g')`,
            variants,
          ),
        ),
      )
      .orderBy(desc(AppointmentTable.npsSentAt))
      .limit(1);

    if (!row || !row.npsSentAt) return null;

    return {
      appointmentId: row.appointmentId,
      companyId: row.companyId,
      companyName: row.companyName,
      googleMapsUrl: row.preferences?.googleMapsUrl ?? null,
      collaboratorId: row.collaboratorId,
      collaboratorName: row.collaboratorName,
      serviceName: row.serviceName,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      npsSentAt: row.npsSentAt,
    };
  }

  public async recordNpsResponse(params: {
    companyId: string;
    appointmentId: string;
    collaboratorId: string;
    clientId: string | null;
    clientName: string;
    serviceName: string;
    rating: number;
    comment: string | null;
    respondedAt: Date;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(AppointmentTable)
        .set({
          npsRespondedAt: params.respondedAt,
          updatedAt: params.respondedAt,
        })
        .where(
          and(
            eq(AppointmentTable.companyId, params.companyId),
            eq(AppointmentTable.id, params.appointmentId),
            isNull(AppointmentTable.npsRespondedAt),
          ),
        )
        .returning({ id: AppointmentTable.id });

      if (!updated) {
        return false;
      }

      await tx.insert(CollaboratorReviewTable).values({
        companyId: params.companyId,
        collaboratorId: params.collaboratorId,
        appointmentId: params.appointmentId,
        clientId: params.clientId,
        clientName: params.clientName.slice(0, 120),
        serviceName: params.serviceName.slice(0, 120),
        rating: params.rating,
        comment: params.comment,
        createdAt: params.respondedAt,
      });

      return true;
    });
  }
}
