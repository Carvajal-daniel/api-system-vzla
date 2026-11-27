import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { Phone } from "../../../../../shared/value-objects/phone.value-object.js";
import { GetAvailabilityUseCase } from "../../../../appointments/application/use-cases/get-availability.use-case.js";
import { DrizzleAppointmentsRepository } from "../../../../appointments/infra/database/repositories/drizzle-appointments.repository.js";
import { DrizzleScheduleBlocksRepository } from "../../../../appointments/infra/database/repositories/drizzle-schedule-blocks.repository.js";
import { DrizzleSchedulingContextLookupRepository } from "../../../../appointments/infra/database/repositories/drizzle-scheduling-context-lookup.repository.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { ScheduleBlockTable } from "../../../../appointments/infra/database/schema/schedule-blocks-schema.js";
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { CollaboratorReviewTable } from "../../../../Collaborators/infra/database/schema/collaborator-reviews-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../../../Company/infra/database/schema/company-settings-schema.js";
import type {
  CascadeDelayRepositoryPort,
  ShiftedAppointmentRecord,
} from "../../../application/cascade-delay.use-case.js";
import type { ChurnRadarRepositoryPort } from "../../../application/churn-radar.use-case.js";
import type {
  EmergencyAbsenceRepositoryPort,
  EmergencyAffectedAppointment,
  EmergencyAlternativeSlot,
} from "../../../application/emergency-absence.use-case.js";
import type {
  ActiveSentSurveyRecord,
  DuePostVisitSurveyRecord,
  PostVisitSurveyRepositoryPort,
} from "../../../application/post-visit-survey.use-case.js";
import type {
  WaitlistEntryRecord,
  WaitlistRepositoryPort,
} from "../../../application/waitlist.use-case.js";
import type { ClientVisitHistory } from "../../../domain/operations-rules.js";
import {
  OwnerAlertTable,
  PostVisitSurveyTable,
  WaitlistEntryTable,
  type OwnerAlertType,
  type PostVisitSurveyStatus,
  type WaitlistShift,
  type WaitlistStatus,
} from "../schema/operations-schema.js";

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

export class DrizzleOperationsRepository
  implements
    CascadeDelayRepositoryPort,
    EmergencyAbsenceRepositoryPort,
    WaitlistRepositoryPort,
    PostVisitSurveyRepositoryPort,
    ChurnRadarRepositoryPort
{
  private readonly availabilityUseCase: GetAvailabilityUseCase;

  constructor() {
    this.availabilityUseCase = new GetAvailabilityUseCase(
      new DrizzleSchedulingContextLookupRepository(),
      new DrizzleScheduleBlocksRepository(),
      new DrizzleAppointmentsRepository(),
    );
  }

  async findCompanyAndCollaborator(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ timezone: string; collaboratorName: string } | null> {
    const [row] = await db
      .select({
        timezone: CompanyTable.timezone,
        collaboratorName: CollaboratorTable.name,
      })
      .from(CollaboratorTable)
      .innerJoin(CompanyTable, eq(CollaboratorTable.companyId, CompanyTable.id))
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.id, collaboratorId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async getCompanyContext(companyId: string): Promise<{
    companyName: string;
    timezone: string;
  } | null> {
    const [row] = await db
      .select({
        companyName: CompanyTable.companyName,
        timezone: CompanyTable.timezone,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return row ?? null;
  }

  async getCompanyName(companyId: string): Promise<string | null> {
    const ctx = await this.getCompanyContext(companyId);
    return ctx?.companyName ?? null;
  }

  // Desloca em transação única os agendamentos futuros PENDING/CONFIRMED do profissional no dia.
  async shiftFutureAppointmentsInDay(params: {
    companyId: string;
    collaboratorId: string;
    windowStartUtc: Date;
    windowEndUtc: Date;
    delayMinutes: number;
    now: Date;
  }): Promise<ShiftedAppointmentRecord[]> {
    const offsetMs = params.delayMinutes * 60 * 1000;

    return db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: AppointmentTable.id,
          clientName: AppointmentTable.clientName,
          clientPhone: AppointmentTable.clientPhone,
          startsAt: AppointmentTable.startsAt,
          endsAt: AppointmentTable.endsAt,
          status: AppointmentTable.status,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, params.companyId),
            eq(AppointmentTable.collaboratorId, params.collaboratorId),
            inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
            gte(AppointmentTable.startsAt, params.windowStartUtc),
            lt(AppointmentTable.startsAt, params.windowEndUtc),
          ),
        )
        .orderBy(asc(AppointmentTable.startsAt));

      const shifted: ShiftedAppointmentRecord[] = [];
      for (const row of rows) {
        const newStartsAt = new Date(row.startsAt.getTime() + offsetMs);
        const newEndsAt = new Date(row.endsAt.getTime() + offsetMs);

        await tx
          .update(AppointmentTable)
          .set({
            startsAt: newStartsAt,
            endsAt: newEndsAt,
            updatedAt: params.now,
          })
          .where(
            and(
              eq(AppointmentTable.companyId, params.companyId),
              eq(AppointmentTable.id, row.id),
            ),
          );

        shifted.push({
          id: row.id,
          clientName: row.clientName,
          clientPhone: row.clientPhone,
          previousStartsAt: row.startsAt,
          previousEndsAt: row.endsAt,
          newStartsAt,
          newEndsAt,
          status: row.status,
        });
      }

      return shifted;
    });
  }

  async createDayScheduleBlock(params: {
    companyId: string;
    collaboratorId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<{ id: string }> {
    const [created] = await db
      .insert(ScheduleBlockTable)
      .values({
        companyId: params.companyId,
        collaboratorId: params.collaboratorId,
        startsAt: params.startsAt,
        endsAt: params.endsAt,
        reason: params.reason,
      })
      .returning({ id: ScheduleBlockTable.id });

    return { id: created!.id };
  }

  async findActiveAppointmentsForCollaboratorInRange(params: {
    companyId: string;
    collaboratorId: string;
    startUtc: Date;
    endUtc: Date;
  }): Promise<EmergencyAffectedAppointment[]> {
    return db
      .select({
        id: AppointmentTable.id,
        serviceId: AppointmentTable.serviceId,
        serviceName: AppointmentTable.serviceNameSnapshot,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
        startsAt: AppointmentTable.startsAt,
        endsAt: AppointmentTable.endsAt,
        status: AppointmentTable.status,
      })
      .from(AppointmentTable)
      .where(
        and(
          eq(AppointmentTable.companyId, params.companyId),
          eq(AppointmentTable.collaboratorId, params.collaboratorId),
          inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
          lt(AppointmentTable.startsAt, params.endUtc),
          gte(AppointmentTable.endsAt, params.startUtc),
        ),
      )
      .orderBy(asc(AppointmentTable.startsAt));
  }

  async findCompatibleAlternativeSlot(params: {
    companyId: string;
    excludeCollaboratorId: string;
    serviceId: string;
    date: string;
    targetStartsAt: Date;
  }): Promise<EmergencyAlternativeSlot | null> {
    try {
      const availability = await this.availabilityUseCase.execute({
        companyId: params.companyId,
        serviceId: params.serviceId,
        date: params.date,
      });

      const candidates = availability.slots
        .filter((slot) => slot.collaboratorId !== params.excludeCollaboratorId)
        .map((slot) => ({
          collaboratorId: slot.collaboratorId,
          collaboratorName: slot.collaboratorName,
          startsAt: new Date(slot.startsAt),
          endsAt: new Date(slot.endsAt),
          distanceMs: Math.abs(
            new Date(slot.startsAt).getTime() - params.targetStartsAt.getTime(),
          ),
        }))
        .sort((a, b) => a.distanceMs - b.distanceMs);

      const best = candidates[0];
      if (!best) return null;

      return {
        collaboratorId: best.collaboratorId,
        collaboratorName: best.collaboratorName,
        startsAt: best.startsAt,
        endsAt: best.endsAt,
      };
    } catch {
      return null;
    }
  }

  async createOwnerAlert(params: {
    companyId: string;
    type: OwnerAlertType;
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const [created] = await db
      .insert(OwnerAlertTable)
      .values({
        companyId: params.companyId,
        type: params.type,
        title: params.title,
        description: params.description,
        metadata: params.metadata,
        isRead: false,
      })
      .returning({ id: OwnerAlertTable.id });

    return { id: created!.id };
  }

  async listOwnerAlerts(params: {
    companyId: string;
    unreadOnly?: boolean | undefined;
    limit?: number | undefined;
  }) {
    const conditions = [eq(OwnerAlertTable.companyId, params.companyId)];
    if (params.unreadOnly) {
      conditions.push(eq(OwnerAlertTable.isRead, false));
    }

    return db
      .select()
      .from(OwnerAlertTable)
      .where(and(...conditions))
      .orderBy(desc(OwnerAlertTable.createdAt))
      .limit(params.limit ?? 50);
  }

  async markOwnerAlertRead(companyId: string, alertId: string): Promise<boolean> {
    const [updated] = await db
      .update(OwnerAlertTable)
      .set({ isRead: true })
      .where(
        and(
          eq(OwnerAlertTable.companyId, companyId),
          eq(OwnerAlertTable.id, alertId),
        ),
      )
      .returning({ id: OwnerAlertTable.id });
    return Boolean(updated);
  }

  async clientExistsInCompany(companyId: string, clientId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: ClientTable.id })
      .from(ClientTable)
      .where(and(eq(ClientTable.companyId, companyId), eq(ClientTable.id, clientId)))
      .limit(1);
    return Boolean(row);
  }

  async collaboratorExistsInCompany(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ id: string; name: string } | null> {
    const [row] = await db
      .select({ id: CollaboratorTable.id, name: CollaboratorTable.name })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.id, collaboratorId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async hydrateWaitlistRows(
    rows: Array<{
      id: string;
      companyId: string;
      clientId: string;
      clientName: string;
      clientPhone: string;
      collaboratorId: string | null;
      collaboratorName: string | null;
      desiredDate: string;
      preferredShift: WaitlistShift;
      status: WaitlistStatus;
      notifiedAt: Date | null;
      expiresAt: Date | null;
      createdAt: Date;
    }>,
  ): Promise<WaitlistEntryRecord[]> {
    return rows.map((row) => ({ ...row }));
  }

  async createEntry(params: {
    companyId: string;
    clientId: string;
    collaboratorId: string | null;
    desiredDate: string;
    preferredShift: WaitlistShift;
  }): Promise<WaitlistEntryRecord> {
    const [created] = await db
      .insert(WaitlistEntryTable)
      .values({
        companyId: params.companyId,
        clientId: params.clientId,
        collaboratorId: params.collaboratorId,
        desiredDate: params.desiredDate,
        preferredShift: params.preferredShift,
        status: "WAITING",
      })
      .returning({ id: WaitlistEntryTable.id });

    const [row] = await db
      .select({
        id: WaitlistEntryTable.id,
        companyId: WaitlistEntryTable.companyId,
        clientId: WaitlistEntryTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        collaboratorId: WaitlistEntryTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        desiredDate: WaitlistEntryTable.desiredDate,
        preferredShift: WaitlistEntryTable.preferredShift,
        status: WaitlistEntryTable.status,
        notifiedAt: WaitlistEntryTable.notifiedAt,
        expiresAt: WaitlistEntryTable.expiresAt,
        createdAt: WaitlistEntryTable.createdAt,
      })
      .from(WaitlistEntryTable)
      .innerJoin(ClientTable, eq(WaitlistEntryTable.clientId, ClientTable.id))
      .leftJoin(
        CollaboratorTable,
        eq(WaitlistEntryTable.collaboratorId, CollaboratorTable.id),
      )
      .where(eq(WaitlistEntryTable.id, created!.id))
      .limit(1);

    return (await this.hydrateWaitlistRows([row!]))[0]!;
  }

  async listEntries(params: {
    companyId: string;
    date: string;
    status?: WaitlistStatus | undefined;
  }): Promise<WaitlistEntryRecord[]> {
    const conditions = [
      eq(WaitlistEntryTable.companyId, params.companyId),
      eq(WaitlistEntryTable.desiredDate, params.date),
    ];
    if (params.status) {
      conditions.push(eq(WaitlistEntryTable.status, params.status));
    }

    const rows = await db
      .select({
        id: WaitlistEntryTable.id,
        companyId: WaitlistEntryTable.companyId,
        clientId: WaitlistEntryTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        collaboratorId: WaitlistEntryTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        desiredDate: WaitlistEntryTable.desiredDate,
        preferredShift: WaitlistEntryTable.preferredShift,
        status: WaitlistEntryTable.status,
        notifiedAt: WaitlistEntryTable.notifiedAt,
        expiresAt: WaitlistEntryTable.expiresAt,
        createdAt: WaitlistEntryTable.createdAt,
      })
      .from(WaitlistEntryTable)
      .innerJoin(ClientTable, eq(WaitlistEntryTable.clientId, ClientTable.id))
      .leftJoin(
        CollaboratorTable,
        eq(WaitlistEntryTable.collaboratorId, CollaboratorTable.id),
      )
      .where(and(...conditions))
      .orderBy(asc(WaitlistEntryTable.createdAt));

    return this.hydrateWaitlistRows(rows);
  }

  async findWaitingCandidatesForDate(params: {
    companyId: string;
    desiredDate: string;
    collaboratorId: string | null;
  }): Promise<WaitlistEntryRecord[]> {
    const conditions = [
      eq(WaitlistEntryTable.companyId, params.companyId),
      eq(WaitlistEntryTable.desiredDate, params.desiredDate),
      eq(WaitlistEntryTable.status, "WAITING"),
    ];

    if (params.collaboratorId) {
      conditions.push(
        or(
          eq(WaitlistEntryTable.collaboratorId, params.collaboratorId),
          sql`${WaitlistEntryTable.collaboratorId} IS NULL`,
        )!,
      );
    }

    const rows = await db
      .select({
        id: WaitlistEntryTable.id,
        companyId: WaitlistEntryTable.companyId,
        clientId: WaitlistEntryTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        collaboratorId: WaitlistEntryTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        desiredDate: WaitlistEntryTable.desiredDate,
        preferredShift: WaitlistEntryTable.preferredShift,
        status: WaitlistEntryTable.status,
        notifiedAt: WaitlistEntryTable.notifiedAt,
        expiresAt: WaitlistEntryTable.expiresAt,
        createdAt: WaitlistEntryTable.createdAt,
      })
      .from(WaitlistEntryTable)
      .innerJoin(ClientTable, eq(WaitlistEntryTable.clientId, ClientTable.id))
      .leftJoin(
        CollaboratorTable,
        eq(WaitlistEntryTable.collaboratorId, CollaboratorTable.id),
      )
      .where(and(...conditions))
      .orderBy(asc(WaitlistEntryTable.createdAt));

    return this.hydrateWaitlistRows(rows);
  }

  async markEntryNotified(params: {
    companyId: string;
    entryId: string;
    notifiedAt: Date;
    expiresAt: Date;
  }): Promise<WaitlistEntryRecord | null> {
    const [updated] = await db
      .update(WaitlistEntryTable)
      .set({
        status: "NOTIFIED",
        notifiedAt: params.notifiedAt,
        expiresAt: params.expiresAt,
        updatedAt: params.notifiedAt,
      })
      .where(
        and(
          eq(WaitlistEntryTable.companyId, params.companyId),
          eq(WaitlistEntryTable.id, params.entryId),
          eq(WaitlistEntryTable.status, "WAITING"),
        ),
      )
      .returning({ id: WaitlistEntryTable.id });

    if (!updated) return null;

    const [row] = await db
      .select({
        id: WaitlistEntryTable.id,
        companyId: WaitlistEntryTable.companyId,
        clientId: WaitlistEntryTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        collaboratorId: WaitlistEntryTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        desiredDate: WaitlistEntryTable.desiredDate,
        preferredShift: WaitlistEntryTable.preferredShift,
        status: WaitlistEntryTable.status,
        notifiedAt: WaitlistEntryTable.notifiedAt,
        expiresAt: WaitlistEntryTable.expiresAt,
        createdAt: WaitlistEntryTable.createdAt,
      })
      .from(WaitlistEntryTable)
      .innerJoin(ClientTable, eq(WaitlistEntryTable.clientId, ClientTable.id))
      .leftJoin(
        CollaboratorTable,
        eq(WaitlistEntryTable.collaboratorId, CollaboratorTable.id),
      )
      .where(eq(WaitlistEntryTable.id, updated.id))
      .limit(1);

    return row ? (await this.hydrateWaitlistRows([row]))[0]! : null;
  }

  async expireStaleNotifiedEntries(now: Date): Promise<WaitlistEntryRecord[]> {
    const staleRows = await db
      .select({
        id: WaitlistEntryTable.id,
        companyId: WaitlistEntryTable.companyId,
        clientId: WaitlistEntryTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        collaboratorId: WaitlistEntryTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        desiredDate: WaitlistEntryTable.desiredDate,
        preferredShift: WaitlistEntryTable.preferredShift,
        status: WaitlistEntryTable.status,
        notifiedAt: WaitlistEntryTable.notifiedAt,
        expiresAt: WaitlistEntryTable.expiresAt,
        createdAt: WaitlistEntryTable.createdAt,
      })
      .from(WaitlistEntryTable)
      .innerJoin(ClientTable, eq(WaitlistEntryTable.clientId, ClientTable.id))
      .leftJoin(
        CollaboratorTable,
        eq(WaitlistEntryTable.collaboratorId, CollaboratorTable.id),
      )
      .where(
        and(
          eq(WaitlistEntryTable.status, "NOTIFIED"),
          isNotNull(WaitlistEntryTable.expiresAt),
          lte(WaitlistEntryTable.expiresAt, now),
        ),
      );

    if (staleRows.length === 0) return [];

    const expired: WaitlistEntryRecord[] = [];
    for (const row of staleRows) {
      const [updated] = await db
        .update(WaitlistEntryTable)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(
          and(
            eq(WaitlistEntryTable.id, row.id),
            eq(WaitlistEntryTable.status, "NOTIFIED"),
          ),
        )
        .returning({ id: WaitlistEntryTable.id });

      if (updated) {
        expired.push({ ...row, status: "EXPIRED" });
      }
    }

    return expired;
  }

  // Agenda pesquisa pós-atendimento de forma idempotente (1 por appointmentId) se a empresa tiver pesquisa habilitada.
  async scheduleSurveyForClosedOrder(params: {
    companyId: string;
    appointmentId: string;
    clientPhone?: string | null | undefined;
    clientName?: string | null | undefined;
    scheduledFor: Date;
  }): Promise<{ scheduled: boolean; surveyId?: string }> {
    const [company] = await db
      .select({
        enablePostVisitSurvey: CompanyTable.enablePostVisitSurvey,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, params.companyId))
      .limit(1);

    if (!company || !company.enablePostVisitSurvey) {
      return { scheduled: false };
    }

    const [appointment] = await db
      .select({
        id: AppointmentTable.id,
        clientName: AppointmentTable.clientName,
        clientPhone: AppointmentTable.clientPhone,
      })
      .from(AppointmentTable)
      .where(
        and(
          eq(AppointmentTable.companyId, params.companyId),
          eq(AppointmentTable.id, params.appointmentId),
        ),
      )
      .limit(1);

    if (!appointment) {
      return { scheduled: false };
    }

    const rawPhone = params.clientPhone?.trim() || appointment.clientPhone;
    const clientName = params.clientName?.trim() || appointment.clientName;

    let normalizedPhone: string;
    try {
      normalizedPhone = Phone.create(rawPhone).value;
    } catch {
      normalizedPhone = rawPhone;
    }

    const variants = buildPhoneDigitVariants(normalizedPhone);
    let [client] =
      variants.length > 0
        ? await db
            .select({ id: ClientTable.id })
            .from(ClientTable)
            .where(
              and(
                eq(ClientTable.companyId, params.companyId),
                inArray(
                  sql`regexp_replace(${ClientTable.phone}, '\\D', '', 'g')`,
                  variants,
                ),
              ),
            )
            .limit(1)
        : [];

    if (!client) {
      const [insertedClient] = await db
        .insert(ClientTable)
        .values({
          companyId: params.companyId,
          name: clientName,
          phone: normalizedPhone,
          tags: ["order-client"],
        })
        .onConflictDoNothing()
        .returning({ id: ClientTable.id });

      client = insertedClient;
      if (!client) {
        const [refetched] = await db
          .select({ id: ClientTable.id })
          .from(ClientTable)
          .where(
            and(
              eq(ClientTable.companyId, params.companyId),
              eq(ClientTable.phone, normalizedPhone),
            ),
          )
          .limit(1);
        client = refetched;
      }
    }

    if (!client) {
      return { scheduled: false };
    }

    const [created] = await db
      .insert(PostVisitSurveyTable)
      .values({
        companyId: params.companyId,
        appointmentId: params.appointmentId,
        clientId: client.id,
        status: "PENDING_SEND",
        scheduledFor: params.scheduledFor,
      })
      .onConflictDoNothing({ target: PostVisitSurveyTable.appointmentId })
      .returning({ id: PostVisitSurveyTable.id });

    return created
      ? { scheduled: true, surveyId: created.id }
      : { scheduled: false };
  }

  async findDuePendingSurveys(now: Date): Promise<DuePostVisitSurveyRecord[]> {
    return db
      .select({
        id: PostVisitSurveyTable.id,
        companyId: PostVisitSurveyTable.companyId,
        companyName: CompanyTable.companyName,
        appointmentId: PostVisitSurveyTable.appointmentId,
        clientId: PostVisitSurveyTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        serviceName: AppointmentTable.serviceNameSnapshot,
        collaboratorName: CollaboratorTable.name,
        scheduledFor: PostVisitSurveyTable.scheduledFor,
      })
      .from(PostVisitSurveyTable)
      .innerJoin(CompanyTable, eq(PostVisitSurveyTable.companyId, CompanyTable.id))
      .innerJoin(ClientTable, eq(PostVisitSurveyTable.clientId, ClientTable.id))
      .innerJoin(
        AppointmentTable,
        eq(PostVisitSurveyTable.appointmentId, AppointmentTable.id),
      )
      .innerJoin(
        CollaboratorTable,
        eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
      )
      .where(
        and(
          eq(PostVisitSurveyTable.status, "PENDING_SEND"),
          lte(PostVisitSurveyTable.scheduledFor, now),
          eq(CompanyTable.isActive, true),
          eq(CompanyTable.enablePostVisitSurvey, true),
        ),
      )
      .orderBy(asc(PostVisitSurveyTable.scheduledFor));
  }

  async markSurveySent(params: {
    companyId: string;
    surveyId: string;
    sentAt: Date;
  }): Promise<boolean> {
    const [updated] = await db
      .update(PostVisitSurveyTable)
      .set({
        status: "SENT",
        sentAt: params.sentAt,
      })
      .where(
        and(
          eq(PostVisitSurveyTable.companyId, params.companyId),
          eq(PostVisitSurveyTable.id, params.surveyId),
          eq(PostVisitSurveyTable.status, "PENDING_SEND"),
        ),
      )
      .returning({ id: PostVisitSurveyTable.id });

    return Boolean(updated);
  }

  async findRecentSentSurveyByPhone(params: {
    companyId: string;
    phone: string;
    since: Date;
  }): Promise<ActiveSentSurveyRecord | null> {
    const variants = buildPhoneDigitVariants(params.phone);
    if (variants.length === 0) return null;

    const [row] = await db
      .select({
        id: PostVisitSurveyTable.id,
        companyId: PostVisitSurveyTable.companyId,
        companyName: CompanyTable.companyName,
        googleReviewUrl: CompanyTable.googleReviewUrl,
        preferences: CompanySettingsTable.preferences,
        appointmentId: PostVisitSurveyTable.appointmentId,
        collaboratorId: AppointmentTable.collaboratorId,
        collaboratorName: CollaboratorTable.name,
        serviceName: AppointmentTable.serviceNameSnapshot,
        clientId: PostVisitSurveyTable.clientId,
        clientName: ClientTable.name,
        clientPhone: ClientTable.phone,
        sentAt: PostVisitSurveyTable.sentAt,
      })
      .from(PostVisitSurveyTable)
      .innerJoin(CompanyTable, eq(PostVisitSurveyTable.companyId, CompanyTable.id))
      .innerJoin(ClientTable, eq(PostVisitSurveyTable.clientId, ClientTable.id))
      .innerJoin(
        AppointmentTable,
        eq(PostVisitSurveyTable.appointmentId, AppointmentTable.id),
      )
      .innerJoin(
        CollaboratorTable,
        eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
      )
      .leftJoin(
        CompanySettingsTable,
        eq(PostVisitSurveyTable.companyId, CompanySettingsTable.companyId),
      )
      .where(
        and(
          eq(PostVisitSurveyTable.companyId, params.companyId),
          eq(PostVisitSurveyTable.status, "SENT"),
          isNotNull(PostVisitSurveyTable.sentAt),
          gte(PostVisitSurveyTable.sentAt, params.since),
          inArray(
            sql`regexp_replace(${ClientTable.phone}, '\\D', '', 'g')`,
            variants,
          ),
        ),
      )
      .orderBy(desc(PostVisitSurveyTable.sentAt))
      .limit(1);

    if (!row || !row.sentAt) return null;

    return {
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      googleReviewUrl:
        row.googleReviewUrl ?? row.preferences?.googleMapsUrl ?? null,
      appointmentId: row.appointmentId,
      collaboratorId: row.collaboratorId,
      collaboratorName: row.collaboratorName,
      serviceName: row.serviceName,
      clientId: row.clientId,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      sentAt: row.sentAt,
    };
  }

  async recordSurveyAnswer(params: {
    companyId: string;
    surveyId: string;
    appointmentId: string;
    collaboratorId: string;
    clientId: string;
    clientName: string;
    serviceName: string;
    score: number;
    feedbackText: string | null;
    status: Extract<PostVisitSurveyStatus, "ANSWERED" | "ESCALATED_TO_OWNER">;
    answeredAt: Date;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(PostVisitSurveyTable)
        .set({
          score: params.score,
          feedbackText: params.feedbackText,
          status: params.status,
          answeredAt: params.answeredAt,
        })
        .where(
          and(
            eq(PostVisitSurveyTable.companyId, params.companyId),
            eq(PostVisitSurveyTable.id, params.surveyId),
            eq(PostVisitSurveyTable.status, "SENT"),
          ),
        )
        .returning({ id: PostVisitSurveyTable.id });

      if (!updated) return false;

      await tx.insert(CollaboratorReviewTable).values({
        companyId: params.companyId,
        collaboratorId: params.collaboratorId,
        appointmentId: params.appointmentId,
        clientId: params.clientId,
        clientName: params.clientName.slice(0, 120),
        serviceName: params.serviceName.slice(0, 120),
        rating: params.score,
        comment: params.feedbackText,
        createdAt: params.answeredAt,
      });

      return true;
    });
  }

  // Consolida o histórico de atendimentos concluídos por cliente da empresa para o Radar de Churn individual.
  async listCompletedVisitHistories(companyId: string): Promise<ClientVisitHistory[]> {
    const [clients, appointments] = await Promise.all([
      db
        .select({
          id: ClientTable.id,
          name: ClientTable.name,
          phone: ClientTable.phone,
        })
        .from(ClientTable)
        .where(eq(ClientTable.companyId, companyId)),
      db
        .select({
          clientPhone: AppointmentTable.clientPhone,
          startsAt: AppointmentTable.startsAt,
          completedAt: AppointmentTable.completedAt,
          serviceName: AppointmentTable.serviceNameSnapshot,
          collaboratorName: CollaboratorTable.name,
        })
        .from(AppointmentTable)
        .innerJoin(
          CollaboratorTable,
          eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
        )
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.status, "COMPLETED"),
            ne(AppointmentTable.isGuest, true),
          ),
        )
        .orderBy(asc(AppointmentTable.startsAt)),
    ]);

    const clientByDigits = new Map<string, { id: string; name: string; phone: string }>();
    for (const client of clients) {
      for (const variant of buildPhoneDigitVariants(client.phone)) {
        clientByDigits.set(variant, client);
      }
    }

    const grouped = new Map<string, ClientVisitHistory>();
    for (const appt of appointments) {
      const variants = buildPhoneDigitVariants(appt.clientPhone);
      const matchedClient = variants
        .map((v) => clientByDigits.get(v))
        .find((c): c is { id: string; name: string; phone: string } => Boolean(c));

      if (!matchedClient) continue;

      const visitDate = appt.completedAt ?? appt.startsAt;
      const existing = grouped.get(matchedClient.id);
      if (!existing) {
        grouped.set(matchedClient.id, {
          clientId: matchedClient.id,
          clientName: matchedClient.name,
          clientPhone: matchedClient.phone,
          lastServiceName: appt.serviceName,
          lastCollaboratorName: appt.collaboratorName,
          completedVisitDates: [visitDate],
        });
      } else {
        existing.completedVisitDates.push(visitDate);
        existing.lastServiceName = appt.serviceName;
        existing.lastCollaboratorName = appt.collaboratorName;
      }
    }

    return Array.from(grouped.values());
  }
}
