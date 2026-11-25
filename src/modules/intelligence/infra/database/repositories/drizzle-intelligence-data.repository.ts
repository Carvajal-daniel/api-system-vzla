import { and, desc, eq, gte, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { AiProactiveInsightsTable } from "../../../../billing/infra/database/schema/ai-proactive-insights-schema.js";
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { RecoveryMessageTable } from "../../../../clients/infra/database/schema/recovery-messages-schema.js";
import { CollaboratorReviewTable } from "../../../../Collaborators/infra/database/schema/collaborator-reviews-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../../../Company/infra/database/schema/company-settings-schema.js";
import { ReceiptTable } from "../../../../finance/infra/database/schema/collections-schema.js";
import {
  FinanceOrderItemTable,
  FinanceOrderTable,
} from "../../../../finance/infra/database/schema/orders-schema.js";
import { ExpenseTable } from "../../../../finance/infra/database/schema/outflows-schema.js";
import {
  InventoryItemTable,
  InventoryMovementTable,
} from "../../../../inventory/infra/database/schema/inventory-schema.js";
import { WhatsAppConversationsTable } from "../../../../whatsapp/infra/database/schema/whatsapp-conversations-schema.js";
import { WhatsAppMessagesTable } from "../../../../whatsapp/infra/database/schema/whatsapp-messages-schema.js";
import { WorkScheduleTable } from "../../../../work-schedules/infra/database/schema/work-schedules-schema.js";
import type {
  AgendaGapSummary,
  ClientsRetentionMetrics,
  DailyBriefingSnapshot,
  FinanceWeeklyComparison,
  InactiveClientCandidate,
  IntelligenceModule,
  InventoryAlertSummary,
  ModuleMetricsPayload,
  ProactiveScanMetrics,
  ServiceComboCandidate,
  TeamPerformanceSummary,
} from "../../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../../domain/repositories/intelligence-data.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_NAMES_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (
    h === undefined ||
    m === undefined ||
    Number.isNaN(h) ||
    Number.isNaN(m)
  ) {
    return null;
  }
  return h * 60 + m;
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Camada de leitura analítica multi-tenant no Drizzle: todas as consultas filtram obrigatoriamente por companyId.
export class DrizzleIntelligenceDataRepository
  implements IntelligenceDataRepository
{
  public async listActiveTenantIds(): Promise<string[]> {
    const rows = await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.isActive, true));

    return rows.map((row) => row.id);
  }

  public async findInactiveClientsForRetention(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<InactiveClientCandidate[]> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [
      clients,
      appointments,
      collaborators,
      reviews,
      recentRetentionMessages,
      recentRecoveryMessages,
      recentUnhappyInsights,
    ] = await Promise.all([
      db
        .select({
          id: ClientTable.id,
          name: ClientTable.name,
          phone: ClientTable.phone,
          lastVisitAt: ClientTable.lastVisitAt,
        })
        .from(ClientTable)
        .where(eq(ClientTable.companyId, tenantId)),
      db
        .select({
          id: AppointmentTable.id,
          clientPhone: AppointmentTable.clientPhone,
          collaboratorId: AppointmentTable.collaboratorId,
          serviceName: AppointmentTable.serviceNameSnapshot,
          status: AppointmentTable.status,
          cancellationReason: AppointmentTable.cancellationReason,
          startsAt: AppointmentTable.startsAt,
          completedAt: AppointmentTable.completedAt,
        })
        .from(AppointmentTable)
        .where(eq(AppointmentTable.companyId, tenantId))
        .orderBy(desc(AppointmentTable.startsAt))
        .limit(2000),
      db
        .select({
          id: CollaboratorTable.id,
          name: CollaboratorTable.name,
        })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.companyId, tenantId)),
      db
        .select({
          clientId: CollaboratorReviewTable.clientId,
          clientName: CollaboratorReviewTable.clientName,
          appointmentId: CollaboratorReviewTable.appointmentId,
          rating: CollaboratorReviewTable.rating,
          comment: CollaboratorReviewTable.comment,
          createdAt: CollaboratorReviewTable.createdAt,
        })
        .from(CollaboratorReviewTable)
        .where(eq(CollaboratorReviewTable.companyId, tenantId))
        .orderBy(desc(CollaboratorReviewTable.createdAt))
        .limit(1000),
      db
        .select({
          phone: WhatsAppConversationsTable.phone,
        })
        .from(WhatsAppMessagesTable)
        .innerJoin(
          WhatsAppConversationsTable,
          and(
            eq(
              WhatsAppConversationsTable.id,
              WhatsAppMessagesTable.conversationId,
            ),
            eq(WhatsAppConversationsTable.companyId, tenantId),
          ),
        )
        .where(
          and(
            eq(WhatsAppMessagesTable.companyId, tenantId),
            eq(WhatsAppMessagesTable.direction, "OUTBOUND"),
            gte(WhatsAppMessagesTable.sentAt, thirtyDaysAgo),
            sql`${WhatsAppMessagesTable.metadata}->>'feature' = 'RETENTION'`,
          ),
        ),
      db
        .select({
          clientId: RecoveryMessageTable.clientId,
        })
        .from(RecoveryMessageTable)
        .where(
          and(
            eq(RecoveryMessageTable.companyId, tenantId),
            gte(RecoveryMessageTable.approvedAt, thirtyDaysAgo),
          ),
        ),
      db
        .select({
          actionPayload: AiProactiveInsightsTable.actionPayload,
        })
        .from(AiProactiveInsightsTable)
        .where(
          and(
            eq(AiProactiveInsightsTable.tenantId, tenantId),
            eq(AiProactiveInsightsTable.type, "UNHAPPY_CLIENT_RESCUE"),
            gte(AiProactiveInsightsTable.createdAt, thirtyDaysAgo),
          ),
        ),
    ]);

    const collaboratorNameById = new Map(
      collaborators.map((c) => [c.id, c.name]),
    );

    const recentlyApproachedPhones = new Set(
      recentRetentionMessages.map((r) => normalizePhoneDigits(r.phone)),
    );
    const recentlyApproachedClientIds = new Set(
      recentRecoveryMessages.map((r) => r.clientId),
    );
    for (const insight of recentUnhappyInsights) {
      const payload = insight.actionPayload;
      if (payload && typeof payload.clientId === "string") {
        recentlyApproachedClientIds.add(payload.clientId);
      }
      if (payload && typeof payload.clientPhone === "string") {
        recentlyApproachedPhones.add(normalizePhoneDigits(payload.clientPhone));
      }
    }

    // Indexa agendamentos por telefone normalizado para consulta O(1) por cliente.
    const appointmentsByPhone = new Map<string, typeof appointments>();
    for (const appt of appointments) {
      const key = normalizePhoneDigits(appt.clientPhone);
      const list = appointmentsByPhone.get(key) ?? [];
      list.push(appt);
      appointmentsByPhone.set(key, list);
    }

    const candidates: InactiveClientCandidate[] = [];

    for (const client of clients) {
      const phoneKey = normalizePhoneDigits(client.phone);
      if (
        !phoneKey ||
        recentlyApproachedPhones.has(phoneKey) ||
        recentlyApproachedClientIds.has(client.id)
      ) {
        continue;
      }

      const clientAppts = appointmentsByPhone.get(phoneKey) ?? [];
      const hasRecentCompleted = clientAppts.some(
        (appt) =>
          appt.status === "COMPLETED" &&
          (appt.completedAt ?? appt.startsAt) >= thirtyDaysAgo,
      );
      if (hasRecentCompleted) {
        continue;
      }

      const hasFutureBooking = clientAppts.some(
        (appt) =>
          (appt.status === "PENDING" || appt.status === "CONFIRMED") &&
          appt.startsAt >= now,
      );
      if (hasFutureBooking) {
        continue;
      }

      const latestAppt = clientAppts[0] ?? null;
      const latestCompleted =
        clientAppts.find((appt) => appt.status === "COMPLETED") ?? null;
      const lastCompletedAt =
        latestCompleted?.completedAt ??
        latestCompleted?.startsAt ??
        client.lastVisitAt ??
        null;

      // Exige histórico prévio (visita concluída há +30 dias ou último agendamento cancelado).
      if (
        lastCompletedAt &&
        lastCompletedAt >= thirtyDaysAgo &&
        latestAppt?.status !== "CANCELED"
      ) {
        continue;
      }
      if (!lastCompletedAt && !latestAppt) {
        continue;
      }

      const referenceTimestamp =
        lastCompletedAt ?? latestAppt?.startsAt ?? thirtyDaysAgo;
      const daysSinceLastVisit = Math.max(
        30,
        Math.floor((now.getTime() - referenceTimestamp.getTime()) / DAY_MS),
      );

      // Profissional preferido pelo maior número de atendimentos concluídos (ou último agendamento).
      const collabCounts = new Map<string, number>();
      for (const appt of clientAppts) {
        if (appt.status === "COMPLETED") {
          collabCounts.set(
            appt.collaboratorId,
            (collabCounts.get(appt.collaboratorId) ?? 0) + 1,
          );
        }
      }
      let preferredCollabId = latestAppt?.collaboratorId ?? null;
      let maxCount = 0;
      for (const [collabId, count] of collabCounts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          preferredCollabId = collabId;
        }
      }

      const clientApptIds = new Set(clientAppts.map((a) => a.id));
      const latestReview =
        reviews.find(
          (rev) =>
            (rev.clientId && rev.clientId === client.id) ||
            (rev.appointmentId && clientApptIds.has(rev.appointmentId)) ||
            rev.clientName.trim().toLowerCase() ===
              client.name.trim().toLowerCase(),
        ) ?? null;

      candidates.push({
        clientId: client.id,
        clientName: client.name,
        clientPhone: client.phone,
        lastCompletedAt,
        daysSinceLastVisit,
        lastAppointmentStatus: latestAppt?.status ?? null,
        lastCancellationReason: latestAppt?.cancellationReason ?? null,
        lastServiceName:
          latestCompleted?.serviceName ?? latestAppt?.serviceName ?? null,
        preferredCollaboratorName: preferredCollabId
          ? (collaboratorNameById.get(preferredCollabId) ?? null)
          : null,
        lastReviewRating: latestReview?.rating ?? null,
        lastReviewComment: latestReview?.comment ?? null,
      });
    }

    return candidates.slice(0, 50);
  }

  public async getProactiveScanMetrics(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<ProactiveScanMetrics> {
    const [
      companyRow,
      agendaGaps,
      finance,
      serviceCombos,
      inventory,
      team,
      clients,
    ] = await Promise.all([
      db
        .select({ companyName: CompanyTable.companyName, name: CompanyTable.name })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, tenantId))
        .limit(1),
      this.computeAgendaGaps48h(tenantId, now),
      this.computeFinanceWeeklyComparison(tenantId, now),
      this.computeServiceCombos(tenantId, now),
      this.computeInventoryAlerts(tenantId, now),
      this.computeTeamPerformance(tenantId, now),
      this.computeClientsMetrics(tenantId, now),
    ]);

    return {
      companyId: tenantId,
      companyName:
        companyRow[0]?.companyName || companyRow[0]?.name || "Sua Empresa",
      referenceDate: formatDateOnly(now),
      agendaGaps,
      finance,
      serviceCombos,
      inventory,
      team,
      clients,
    };
  }

  public async getModuleAggregatedMetrics(
    tenantId: string,
    module: IntelligenceModule,
    now: Date = new Date(),
  ): Promise<ModuleMetricsPayload> {
    const [companyRow] = await db
      .select({ companyName: CompanyTable.companyName, name: CompanyTable.name })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, tenantId))
      .limit(1);

    const companyName =
      companyRow?.companyName || companyRow?.name || "Sua Empresa";
    const referenceDate = formatDateOnly(now);

    switch (module) {
      case "AGENDA": {
        const gaps = await this.computeAgendaGaps48h(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { agendaGaps48h: gaps },
        };
      }
      case "FINANCE": {
        const finance = await this.computeFinanceWeeklyComparison(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { finance },
        };
      }
      case "SERVICES": {
        const combos = await this.computeServiceCombos(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { serviceCombos: combos },
        };
      }
      case "INVENTORY": {
        const inventory = await this.computeInventoryAlerts(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { inventory },
        };
      }
      case "TEAM": {
        const team = await this.computeTeamPerformance(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { team },
        };
      }
      case "CLIENTS": {
        const clients = await this.computeClientsMetrics(tenantId, now);
        return {
          module,
          companyName,
          referenceDate,
          metrics: { clients },
        };
      }
    }
  }

  public async getDailyBriefingSnapshot(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<DailyBriefingSnapshot | null> {
    const [companyRow] = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        name: CompanyTable.name,
        phone: CompanyTable.phone,
        timezone: CompanyTable.timezone,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, tenantId))
      .limit(1);

    if (!companyRow) {
      return null;
    }

    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );
    const endOfDay = new Date(startOfDay.getTime() + DAY_MS);

    const [settingsRow, todayStatsRows, pendingInsightsRows, agendaGaps] =
      await Promise.all([
        db
          .select({ preferences: CompanySettingsTable.preferences })
          .from(CompanySettingsTable)
          .where(eq(CompanySettingsTable.companyId, tenantId))
          .limit(1),
        db
          .select({
            confirmedCount: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.status} = 'CONFIRMED')::int`,
            pendingCount: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.status} = 'PENDING')::int`,
            projectedRevenueCents: sql<number>`COALESCE(SUM(CASE WHEN ${AppointmentTable.status} IN ('CONFIRMED', 'PENDING', 'COMPLETED') THEN ${AppointmentTable.servicePriceInCentsSnapshot} ELSE 0 END), 0)::int`,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, tenantId),
              gte(AppointmentTable.startsAt, startOfDay),
              lt(AppointmentTable.startsAt, endOfDay),
            ),
          ),
        db
          .select({ count: sql<number>`COUNT(*)::int` })
          .from(AiProactiveInsightsTable)
          .where(
            and(
              eq(AiProactiveInsightsTable.tenantId, tenantId),
              eq(AiProactiveInsightsTable.status, "PENDING"),
            ),
          ),
        this.computeAgendaGaps48h(tenantId, now),
      ]);

    const configuredServicePhone =
      settingsRow[0]?.preferences?.reminders?.servicePhone?.trim() || null;
    const ownerPhone = configuredServicePhone || companyRow.phone || null;
    const criticalGaps = agendaGaps.filter((gap) => gap.idlePercentage >= 50);

    return {
      companyId: companyRow.id,
      companyName: companyRow.companyName || companyRow.name,
      companyTimezone: companyRow.timezone || "America/Sao_Paulo",
      ownerPhone,
      referenceDate: formatDateOnly(now),
      confirmedAppointmentsToday: todayStatsRows[0]?.confirmedCount ?? 0,
      pendingAppointmentsToday: todayStatsRows[0]?.pendingCount ?? 0,
      projectedRevenueTodayCents:
        todayStatsRows[0]?.projectedRevenueCents ?? 0,
      criticalIdleSlotsCount: criticalGaps.length,
      criticalIdleSummary: criticalGaps
        .slice(0, 3)
        .map((g) => `${g.collaboratorName} (${g.idlePercentage}% livre)`),
      pendingInsightsCount: pendingInsightsRows[0]?.count ?? 0,
    };
  }

  private async computeAgendaGaps48h(
    tenantId: string,
    now: Date,
  ): Promise<AgendaGapSummary[]> {
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * DAY_MS);

    const [collaborators, schedules, upcomingAppointments, recentCompleted] =
      await Promise.all([
        db
          .select({
            id: CollaboratorTable.id,
            name: CollaboratorTable.name,
          })
          .from(CollaboratorTable)
          .where(
            and(
              eq(CollaboratorTable.companyId, tenantId),
              eq(CollaboratorTable.isActive, true),
            ),
          ),
        db
          .select({
            collaboratorId: WorkScheduleTable.collaboratorId,
            dayOfWeek: WorkScheduleTable.dayOfWeek,
            isWorkingDay: WorkScheduleTable.isWorkingDay,
            startTime: WorkScheduleTable.startTime,
            endTime: WorkScheduleTable.endTime,
            breakStart: WorkScheduleTable.breakStart,
            breakEnd: WorkScheduleTable.breakEnd,
          })
          .from(WorkScheduleTable)
          .where(eq(WorkScheduleTable.companyId, tenantId)),
        db
          .select({
            collaboratorId: AppointmentTable.collaboratorId,
            durationMinutes: AppointmentTable.serviceDurationMinutesSnapshot,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, tenantId),
              gte(AppointmentTable.startsAt, now),
              lte(AppointmentTable.startsAt, in48h),
              ne(AppointmentTable.status, "CANCELED"),
            ),
          ),
        db
          .select({
            collaboratorId: AppointmentTable.collaboratorId,
            clientName: AppointmentTable.clientName,
            clientPhone: AppointmentTable.clientPhone,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, tenantId),
              eq(AppointmentTable.status, "COMPLETED"),
              gte(AppointmentTable.startsAt, ninetyDaysAgo),
            ),
          )
          .orderBy(desc(AppointmentTable.startsAt))
          .limit(300),
      ]);

    const todayDow = now.getUTCDay();
    const tomorrowDow = new Date(now.getTime() + DAY_MS).getUTCDay();
    const targetDays = new Set([todayDow, tomorrowDow]);

    const gaps: AgendaGapSummary[] = [];

    for (const collab of collaborators) {
      const collabSchedules = schedules.filter(
        (s) =>
          s.collaboratorId === collab.id &&
          s.isWorkingDay &&
          targetDays.has(s.dayOfWeek),
      );

      let totalAvailableMinutes48h = 0;
      for (const sched of collabSchedules) {
        const start = parseMinutes(sched.startTime);
        const end = parseMinutes(sched.endTime);
        if (start === null || end === null || end <= start) continue;
        let minutes = end - start;
        const bStart = parseMinutes(sched.breakStart);
        const bEnd = parseMinutes(sched.breakEnd);
        if (bStart !== null && bEnd !== null && bEnd > bStart) {
          minutes = Math.max(0, minutes - (bEnd - bStart));
        }
        totalAvailableMinutes48h += minutes;
      }

      // Se o profissional não tiver grade cadastrada, assume jornada padrão de 8h/dia (960 min em 48h).
      if (totalAvailableMinutes48h === 0) {
        totalAvailableMinutes48h = 960;
      }

      const bookedMinutes48h = upcomingAppointments
        .filter((a) => a.collaboratorId === collab.id)
        .reduce((acc, a) => acc + a.durationMinutes, 0);

      const idlePercentage = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            ((totalAvailableMinutes48h - bookedMinutes48h) /
              totalAvailableMinutes48h) *
              100,
          ),
        ),
      );

      const seenPhones = new Set<string>();
      const habitualClients: Array<{ clientName: string; clientPhone: string }> =
        [];
      for (const appt of recentCompleted) {
        if (appt.collaboratorId !== collab.id) continue;
        const phoneKey = normalizePhoneDigits(appt.clientPhone);
        if (!phoneKey || seenPhones.has(phoneKey)) continue;
        seenPhones.add(phoneKey);
        habitualClients.push({
          clientName: appt.clientName,
          clientPhone: appt.clientPhone,
        });
        if (habitualClients.length >= 5) break;
      }

      gaps.push({
        collaboratorId: collab.id,
        collaboratorName: collab.name,
        totalAvailableMinutes48h,
        bookedMinutes48h,
        idlePercentage,
        habitualClients,
      });
    }

    return gaps.sort((a, b) => b.idlePercentage - a.idlePercentage);
  }

  private async computeFinanceWeeklyComparison(
    tenantId: string,
    now: Date,
  ): Promise<FinanceWeeklyComparison> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);
    const todayStr = formatDateOnly(now);
    const sevenDaysAgoStr = formatDateOnly(sevenDaysAgo);
    const fourteenDaysAgoStr = formatDateOnly(fourteenDaysAgo);

    const [orders, receipts, expenses] = await Promise.all([
      db
        .select({
          orderDate: FinanceOrderTable.orderDate,
          paidCents: FinanceOrderTable.paidCents,
        })
        .from(FinanceOrderTable)
        .where(
          and(
            eq(FinanceOrderTable.companyId, tenantId),
            gte(FinanceOrderTable.orderDate, fourteenDaysAgoStr),
            lte(FinanceOrderTable.orderDate, todayStr),
          ),
        ),
      db
        .select({
          effectiveOn: ReceiptTable.effectiveOn,
          amountInCents: ReceiptTable.amountInCents,
        })
        .from(ReceiptTable)
        .where(
          and(
            eq(ReceiptTable.companyId, tenantId),
            isNull(ReceiptTable.reversesReceiptId),
            gte(ReceiptTable.effectiveOn, fourteenDaysAgoStr),
            lte(ReceiptTable.effectiveOn, todayStr),
          ),
        ),
      db
        .select({
          pendingCents: sql<number>`COALESCE(SUM(${ExpenseTable.amountCents}), 0)::int`,
        })
        .from(ExpenseTable)
        .where(
          and(
            eq(ExpenseTable.companyId, tenantId),
            eq(ExpenseTable.status, "PENDING"),
          ),
        ),
    ]);

    let currentWeekRevenueCents = 0;
    let previousWeekRevenueCents = 0;
    let currentWeekOrdersCount = 0;
    let previousWeekOrdersCount = 0;
    const revenueByDayOfWeek = new Map<number, number>();

    for (const order of orders) {
      const isCurrent = order.orderDate >= sevenDaysAgoStr;
      if (isCurrent) {
        currentWeekRevenueCents += order.paidCents;
        if (order.paidCents > 0) currentWeekOrdersCount += 1;
      } else {
        previousWeekRevenueCents += order.paidCents;
        if (order.paidCents > 0) previousWeekOrdersCount += 1;
      }
      const dow = new Date(`${order.orderDate}T12:00:00Z`).getUTCDay();
      revenueByDayOfWeek.set(
        dow,
        (revenueByDayOfWeek.get(dow) ?? 0) + order.paidCents,
      );
    }

    for (const receipt of receipts) {
      const isCurrent = receipt.effectiveOn >= sevenDaysAgoStr;
      if (isCurrent) {
        currentWeekRevenueCents += receipt.amountInCents;
        if (receipt.amountInCents > 0) currentWeekOrdersCount += 1;
      } else {
        previousWeekRevenueCents += receipt.amountInCents;
        if (receipt.amountInCents > 0) previousWeekOrdersCount += 1;
      }
      const dow = new Date(`${receipt.effectiveOn}T12:00:00Z`).getUTCDay();
      revenueByDayOfWeek.set(
        dow,
        (revenueByDayOfWeek.get(dow) ?? 0) + receipt.amountInCents,
      );
    }

    let peakDayOfWeek: string | null = null;
    let peakRevenue = 0;
    for (const [dow, total] of revenueByDayOfWeek.entries()) {
      if (total > peakRevenue) {
        peakRevenue = total;
        peakDayOfWeek = DAY_NAMES_PT[dow] ?? null;
      }
    }

    const revenueDeltaPercent =
      previousWeekRevenueCents > 0
        ? Math.round(
            ((currentWeekRevenueCents - previousWeekRevenueCents) /
              previousWeekRevenueCents) *
              100,
          )
        : currentWeekRevenueCents > 0
          ? 100
          : 0;

    return {
      currentWeekRevenueCents,
      previousWeekRevenueCents,
      revenueDeltaPercent,
      currentWeekAvgTicketCents:
        currentWeekOrdersCount > 0
          ? Math.round(currentWeekRevenueCents / currentWeekOrdersCount)
          : 0,
      previousWeekAvgTicketCents:
        previousWeekOrdersCount > 0
          ? Math.round(previousWeekRevenueCents / previousWeekOrdersCount)
          : 0,
      currentWeekOrdersCount,
      previousWeekOrdersCount,
      pendingExpensesCents: expenses[0]?.pendingCents ?? 0,
      peakDayOfWeek,
    };
  }

  private async computeServiceCombos(
    tenantId: string,
    now: Date,
  ): Promise<ServiceComboCandidate[]> {
    const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);

    const [orderItems, appointments] = await Promise.all([
      db
        .select({
          orderId: FinanceOrderItemTable.orderId,
          name: FinanceOrderItemTable.name,
        })
        .from(FinanceOrderItemTable)
        .where(
          and(
            eq(FinanceOrderItemTable.companyId, tenantId),
            eq(FinanceOrderItemTable.itemType, "SERVICE"),
            gte(FinanceOrderItemTable.createdAt, sixtyDaysAgo),
          ),
        )
        .limit(1000),
      db
        .select({
          clientPhone: AppointmentTable.clientPhone,
          startsAt: AppointmentTable.startsAt,
          serviceName: AppointmentTable.serviceNameSnapshot,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, tenantId),
            eq(AppointmentTable.status, "COMPLETED"),
            gte(AppointmentTable.startsAt, sixtyDaysAgo),
          ),
        )
        .limit(1000),
    ]);

    const baskets = new Map<string, Set<string>>();
    for (const item of orderItems) {
      const set = baskets.get(`order:${item.orderId}`) ?? new Set<string>();
      set.add(item.name.trim());
      baskets.set(`order:${item.orderId}`, set);
    }
    for (const appt of appointments) {
      const key = `appt:${normalizePhoneDigits(appt.clientPhone)}:${formatDateOnly(appt.startsAt)}`;
      const set = baskets.get(key) ?? new Set<string>();
      set.add(appt.serviceName.trim());
      baskets.set(key, set);
    }

    const pairCounts = new Map<string, number>();
    for (const services of baskets.values()) {
      const unique = Array.from(services).sort();
      for (let i = 0; i < unique.length; i += 1) {
        for (let j = i + 1; j < unique.length; j += 1) {
          const pairKey = `${unique[i]}|||${unique[j]}`;
          pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
        }
      }
    }

    return Array.from(pairCounts.entries())
      .map(([pairKey, coOccurrenceCount]) => {
        const [serviceA = "", serviceB = ""] = pairKey.split("|||");
        return { serviceA, serviceB, coOccurrenceCount };
      })
      .filter((pair) => pair.coOccurrenceCount >= 2)
      .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
      .slice(0, 5);
  }

  private async computeInventoryAlerts(
    tenantId: string,
    now: Date,
  ): Promise<InventoryAlertSummary> {
    const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);

    const [items, recentSales] = await Promise.all([
      db
        .select({
          id: InventoryItemTable.id,
          name: InventoryItemTable.name,
          currentStock: InventoryItemTable.currentStock,
          minStock: InventoryItemTable.minStock,
          salePriceCents: InventoryItemTable.salePriceCents,
          createdAt: InventoryItemTable.createdAt,
        })
        .from(InventoryItemTable)
        .where(
          and(
            eq(InventoryItemTable.companyId, tenantId),
            eq(InventoryItemTable.isActive, true),
          ),
        ),
      db
        .select({
          itemId: InventoryMovementTable.itemId,
        })
        .from(InventoryMovementTable)
        .where(
          and(
            eq(InventoryMovementTable.companyId, tenantId),
            eq(InventoryMovementTable.movementType, "SALE_OUT"),
            gte(InventoryMovementTable.occurredAt, sixtyDaysAgo),
          ),
        ),
    ]);

    const soldRecentlyIds = new Set(recentSales.map((s) => s.itemId));

    const lowStockItems = items
      .filter((item) => item.currentStock <= item.minStock)
      .map((item) => ({
        id: item.id,
        name: item.name,
        currentStock: item.currentStock,
        minStock: item.minStock,
      }))
      .slice(0, 10);

    const stagnantItems60d = items
      .filter(
        (item) =>
          item.currentStock > 0 &&
          item.createdAt <= sixtyDaysAgo &&
          !soldRecentlyIds.has(item.id),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        currentStock: item.currentStock,
        salePriceCents: item.salePriceCents ?? null,
      }))
      .slice(0, 10);

    return { lowStockItems, stagnantItems60d };
  }

  private async computeTeamPerformance(
    tenantId: string,
    now: Date,
  ): Promise<TeamPerformanceSummary[]> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [collaborators, completedAppts, reviews, gaps] = await Promise.all([
      db
        .select({
          id: CollaboratorTable.id,
          name: CollaboratorTable.name,
        })
        .from(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.companyId, tenantId),
            eq(CollaboratorTable.isActive, true),
          ),
        ),
      db
        .select({
          collaboratorId: AppointmentTable.collaboratorId,
          clientPhone: AppointmentTable.clientPhone,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, tenantId),
            eq(AppointmentTable.status, "COMPLETED"),
            gte(AppointmentTable.startsAt, thirtyDaysAgo),
          ),
        ),
      db
        .select({
          collaboratorId: CollaboratorReviewTable.collaboratorId,
          rating: CollaboratorReviewTable.rating,
        })
        .from(CollaboratorReviewTable)
        .where(
          and(
            eq(CollaboratorReviewTable.companyId, tenantId),
            gte(CollaboratorReviewTable.createdAt, thirtyDaysAgo),
          ),
        ),
      this.computeAgendaGaps48h(tenantId, now),
    ]);

    const idleByCollab = new Map(
      gaps.map((gap) => [gap.collaboratorId, gap.idlePercentage]),
    );

    return collaborators.map((collab) => {
      const collabAppts = completedAppts.filter(
        (a) => a.collaboratorId === collab.id,
      );
      const clientVisitCounts = new Map<string, number>();
      for (const appt of collabAppts) {
        const key = normalizePhoneDigits(appt.clientPhone);
        clientVisitCounts.set(key, (clientVisitCounts.get(key) ?? 0) + 1);
      }
      const uniqueClients = clientVisitCounts.size;
      const returningClients = Array.from(clientVisitCounts.values()).filter(
        (count) => count >= 2,
      ).length;
      const returnRatePercent =
        uniqueClients > 0
          ? Math.round((returningClients / uniqueClients) * 100)
          : 0;

      const collabReviews = reviews.filter(
        (r) => r.collaboratorId === collab.id,
      );
      const averageRating =
        collabReviews.length > 0
          ? Math.round(
              (collabReviews.reduce((acc, r) => acc + r.rating, 0) /
                collabReviews.length) *
                10,
            ) / 10
          : null;

      return {
        collaboratorId: collab.id,
        collaboratorName: collab.name,
        completedAppointments30d: collabAppts.length,
        returnRatePercent,
        averageRating,
        reviewsCount: collabReviews.length,
        idlePercentage48h: idleByCollab.get(collab.id) ?? 0,
      };
    });
  }

  private async computeClientsMetrics(
    tenantId: string,
    now: Date,
  ): Promise<ClientsRetentionMetrics> {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [clientStats, unhappyReviews] = await Promise.all([
      db
        .select({
          totalClients: sql<number>`COUNT(*)::int`,
          inactive30dCount: sql<number>`COUNT(*) FILTER (WHERE ${ClientTable.lastVisitAt} IS NULL OR ${ClientTable.lastVisitAt} < ${thirtyDaysAgo})::int`,
          avgTotalSpentCents: sql<number>`COALESCE(AVG(${ClientTable.totalSpentCents}), 0)::int`,
        })
        .from(ClientTable)
        .where(eq(ClientTable.companyId, tenantId)),
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(CollaboratorReviewTable)
        .where(
          and(
            eq(CollaboratorReviewTable.companyId, tenantId),
            lte(CollaboratorReviewTable.rating, 3),
            gte(CollaboratorReviewTable.createdAt, thirtyDaysAgo),
          ),
        ),
    ]);

    return {
      totalClients: clientStats[0]?.totalClients ?? 0,
      inactive30dCount: clientStats[0]?.inactive30dCount ?? 0,
      avgTotalSpentCents: clientStats[0]?.avgTotalSpentCents ?? 0,
      recentUnhappyReviewsCount: unhappyReviews[0]?.count ?? 0,
    };
  }
}
