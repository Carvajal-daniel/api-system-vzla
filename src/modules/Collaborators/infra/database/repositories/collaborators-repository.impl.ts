import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { ScheduleBlockTable } from "../../../../appointments/infra/database/schema/schedule-blocks-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { resolveCompanyRankingWeights } from "../../../../Company/domain/ranking-weights.js";
import { InventoryMovementTable } from "../../../../inventory/infra/database/schema/inventory-schema.js";
import { CollaboratorServiceTable } from "../../../../services/infra/database/schema/collaborator-services-schema.js";
import { ServiceTable } from "../../../../services/infra/database/schema/services-schema.js";
import { WorkScheduleTable } from "../../../../work-schedules/infra/database/schema/work-schedules-schema.js";
import {
  AwardAlreadyClosedError,
  CollaboratorEmailAlreadyInError,
  NoCollaboratorsToAwardError,
} from "../../../application/errors/collaborator-errors.js";
import {
  CollaboratorEntity,
  type CollaboratorStatus,
} from "../../../domain/entities/collaborator.entity.js";
import type {
  CloseMonthAwardResult,
  CollaboratorAwardRecord,
  CollaboratorLinkedServiceRecord,
  CollaboratorMetricSummary,
  CollaboratorProfileDossier,
  CollaboratorRecord,
  CollaboratorReviewRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../../../domain/repository/collaborators.repository.interface.js";
import {
  CollaboratorRankingCalculator,
} from "../../../domain/services/collaborator-ranking-calculator.service.js";
import type { CollaboratorDayScheduleInput } from "../../../domain/services/collaborator-schedule-validator.service.js";
import { AiRescheduleQueueTable } from "../schema/ai-reschedule-queue-schema.js";
import { CollaboratorAwardTable } from "../schema/collaborator-awards-schema.js";
import { CollaboratorReviewTable } from "../schema/collaborator-reviews-schema.js";
import { CollaboratorScheduleTable } from "../schema/collaborator-schedules-schema.js";
import { CollaboratorTable } from "../schema/collaborators-schema.js";

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

function formatTenure(months: number): string {
  if (months < 1) return "Menos de 1 mês";
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;

  if (years === 0) {
    return `${months} ${months === 1 ? "mês" : "meses"}`;
  }
  if (remainingMonths === 0) {
    return `${years} ${years === 1 ? "ano" : "anos"}`;
  }
  return `${years} ${years === 1 ? "ano" : "anos"} e ${remainingMonths} ${remainingMonths === 1 ? "mês" : "meses"}`;
}

export class CollaboratorRepositoryDB implements CollaboratorsRepository {
  async existsByEmail(email: string): Promise<boolean> {
    const [collaboratorRow, companyRow] = await Promise.all([
      db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.email, email))
        .limit(1),
      db
        .select({ id: CompanyTable.id })
        .from(CompanyTable)
        .where(eq(CompanyTable.email, email))
        .limit(1),
    ]);

    return collaboratorRow.length > 0 || companyRow.length > 0;
  }

  async companyExistsById(companyId: string): Promise<boolean> {
    const result = await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return result.length > 0;
  }

  async save(collaborator: CollaboratorEntity): Promise<void> {
    try {
      await db.insert(CollaboratorTable).values({
        id: collaborator.id,
        name: collaborator.name,
        email: collaborator.email,
        password: collaborator.password,
        phone: collaborator.phone,
        whatsapp: collaborator.whatsapp ?? null,
        companyId: collaborator.companyId,
        specialty: collaborator.specialty,
        bio: collaborator.bio ?? null,
        commissionPercentage: collaborator.commissionPercentage,
        defaultCommissionRate: collaborator.defaultCommissionRate,
        monthlyRevenueGoal: collaborator.monthlyRevenueGoal ?? null,
        status: collaborator.status,
        isActive: collaborator.isActive,
        avatarUrl: collaborator.avatarUrl ?? null,
        hiredAt: collaborator.hiredAt,
        deactivatedAt: collaborator.deactivatedAt ?? null,
        deactivationReason: collaborator.deactivationReason ?? null,
        createdAt: collaborator.createdAt,
        updatedAt: collaborator.updatedAt,
      });
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new CollaboratorEmailAlreadyInError();
      }
      throw error;
    }
  }

  async findById(collaboratorId: string, companyId: string): Promise<CollaboratorEntity | null> {
    const rows = await db
      .select()
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return CollaboratorEntity.reconstitute({
      id: row.id,
      companyId: row.companyId,
      name: row.name,
      email: row.email,
      password: row.password,
      phone: row.phone,
      whatsapp: row.whatsapp,
      specialty: row.specialty,
      bio: row.bio,
      commissionPercentage: Number(row.commissionPercentage ?? row.defaultCommissionRate ?? 0),
      defaultCommissionRate: Number(row.defaultCommissionRate ?? row.commissionPercentage ?? 0),
      monthlyRevenueGoal: row.monthlyRevenueGoal,
      status: (row.status as CollaboratorStatus) ?? (row.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: row.isActive ?? (row.status === "ACTIVE"),
      avatarUrl: row.avatarUrl,
      hiredAt: row.hiredAt ? new Date(row.hiredAt) : new Date(),
      deactivatedAt: row.deactivatedAt ? new Date(row.deactivatedAt) : null,
      deactivationReason: row.deactivationReason,
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
    });
  }

  async findAllByCompanyId(
    companyId: string,
    filters?: { serviceId?: string; status?: CollaboratorStatus },
  ): Promise<CollaboratorRecord[]> {
    let query = db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        email: CollaboratorTable.email,
        phone: CollaboratorTable.phone,
        whatsapp: CollaboratorTable.whatsapp,
        specialty: CollaboratorTable.specialty,
        bio: CollaboratorTable.bio,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        defaultCommissionRate: CollaboratorTable.defaultCommissionRate,
        monthlyRevenueGoal: CollaboratorTable.monthlyRevenueGoal,
        status: CollaboratorTable.status,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
        hiredAt: CollaboratorTable.hiredAt,
        deactivatedAt: CollaboratorTable.deactivatedAt,
        deactivationReason: CollaboratorTable.deactivationReason,
        createdAt: CollaboratorTable.createdAt,
        updatedAt: CollaboratorTable.updatedAt,
      })
      .from(CollaboratorTable);

    const conditions = [eq(CollaboratorTable.companyId, companyId)];

    if (filters?.status) {
      conditions.push(eq(CollaboratorTable.status, filters.status));
    }

    if (filters?.serviceId) {
      const linkedCollabs = await db
        .select({ collaboratorId: CollaboratorServiceTable.collaboratorId })
        .from(CollaboratorServiceTable)
        .where(
          and(
            eq(CollaboratorServiceTable.companyId, companyId),
            eq(CollaboratorServiceTable.serviceId, filters.serviceId),
          ),
        );

      const ids = linkedCollabs.map((r) => r.collaboratorId);
      if (ids.length === 0) return [];
      conditions.push(inArray(CollaboratorTable.id, ids));
    }

    const rows = await query.where(and(...conditions)).orderBy(CollaboratorTable.name);

    return rows.map((row) => ({
      ...row,
      commissionPercentage: Number(row.commissionPercentage ?? row.defaultCommissionRate ?? 0),
      defaultCommissionRate: Number(row.defaultCommissionRate ?? row.commissionPercentage ?? 0),
      status: (row.status as CollaboratorStatus) ?? (row.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: row.isActive ?? (row.status === "ACTIVE"),
      hiredAt: new Date(row.hiredAt),
      deactivatedAt: row.deactivatedAt ? new Date(row.deactivatedAt) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  async update(collaborator: CollaboratorEntity): Promise<void> {
    await db
      .update(CollaboratorTable)
      .set({
        name: collaborator.name,
        email: collaborator.email,
        password: collaborator.password,
        phone: collaborator.phone,
        whatsapp: collaborator.whatsapp ?? null,
        specialty: collaborator.specialty,
        bio: collaborator.bio ?? null,
        commissionPercentage: collaborator.commissionPercentage,
        defaultCommissionRate: collaborator.defaultCommissionRate,
        monthlyRevenueGoal: collaborator.monthlyRevenueGoal ?? null,
        status: collaborator.status,
        isActive: collaborator.isActive,
        avatarUrl: collaborator.avatarUrl ?? null,
        hiredAt: collaborator.hiredAt,
        deactivatedAt: collaborator.deactivatedAt ?? null,
        deactivationReason: collaborator.deactivationReason ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(CollaboratorTable.id, collaborator.id),
          eq(CollaboratorTable.companyId, collaborator.companyId),
        ),
      );
  }

  async updateStatusInCompany(
    collaboratorId: string,
    companyId: string,
    isActive: boolean,
  ): Promise<CollaboratorRecord | null> {
    const status: CollaboratorStatus = isActive ? "ACTIVE" : "INACTIVE";
    const rows = await db
      .update(CollaboratorTable)
      .set({
        isActive,
        status,
        deactivatedAt: isActive ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      commissionPercentage: Number(row.commissionPercentage ?? row.defaultCommissionRate ?? 0),
      defaultCommissionRate: Number(row.defaultCommissionRate ?? row.commissionPercentage ?? 0),
      status: (row.status as CollaboratorStatus) ?? (row.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: row.isActive,
      hiredAt: new Date(row.hiredAt),
      deactivatedAt: row.deactivatedAt ? new Date(row.deactivatedAt) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async updateDetailsInCompany(
    collaboratorId: string,
    companyId: string,
    data: { name?: string; specialty?: string; commissionPercentage?: number },
  ): Promise<CollaboratorRecord | null> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.specialty !== undefined) patch.specialty = data.specialty;
    if (data.commissionPercentage !== undefined) {
      patch.commissionPercentage = data.commissionPercentage;
      patch.defaultCommissionRate = data.commissionPercentage;
    }

    const rows = await db
      .update(CollaboratorTable)
      .set(patch)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      commissionPercentage: Number(row.commissionPercentage ?? row.defaultCommissionRate ?? 0),
      defaultCommissionRate: Number(row.defaultCommissionRate ?? row.commissionPercentage ?? 0),
      status: (row.status as CollaboratorStatus) ?? (row.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: row.isActive,
      hiredAt: new Date(row.hiredAt),
      deactivatedAt: row.deactivatedAt ? new Date(row.deactivatedAt) : null,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async deleteInCompany(
    collaboratorId: string,
    companyId: string,
    transferToCollaboratorId?: string,
  ): Promise<"deleted" | "not_found" | "has_appointments" | "destination_not_found"> {
    const existing = await db
      .select({ id: CollaboratorTable.id })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (existing.length === 0) return "not_found";

    if (transferToCollaboratorId) {
      const destination = await db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.id, transferToCollaboratorId),
            eq(CollaboratorTable.companyId, companyId),
            eq(CollaboratorTable.isActive, true),
          ),
        )
        .limit(1);

      if (destination.length === 0) return "destination_not_found";

      await db
        .update(AppointmentTable)
        .set({
          collaboratorId: transferToCollaboratorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.collaboratorId, collaboratorId),
          ),
        );
    } else {
      const linked = await db
        .select({ id: AppointmentTable.id })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.collaboratorId, collaboratorId),
          ),
        )
        .limit(1);

      if (linked.length > 0) return "has_appointments";
    }

    try {
      await db
        .delete(CollaboratorServiceTable)
        .where(
          and(
            eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
            eq(CollaboratorServiceTable.companyId, companyId),
          ),
        );

      await db
        .delete(WorkScheduleTable)
        .where(
          and(
            eq(WorkScheduleTable.collaboratorId, collaboratorId),
            eq(WorkScheduleTable.companyId, companyId),
          ),
        );

      await db
        .delete(CollaboratorScheduleTable)
        .where(
          and(
            eq(CollaboratorScheduleTable.collaboratorId, collaboratorId),
            eq(CollaboratorScheduleTable.companyId, companyId),
          ),
        );

      await db
        .delete(ScheduleBlockTable)
        .where(
          and(
            eq(ScheduleBlockTable.collaboratorId, collaboratorId),
            eq(ScheduleBlockTable.companyId, companyId),
          ),
        );

      const deleted = await db
        .delete(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.id, collaboratorId),
            eq(CollaboratorTable.companyId, companyId),
          ),
        )
        .returning({ id: CollaboratorTable.id });

      return deleted.length > 0 ? "deleted" : "not_found";
    } catch (error) {
      const candidate = error as { code?: unknown; cause?: { code?: unknown } };
      if (candidate?.code === "23503" || candidate?.cause?.code === "23503") {
        return "has_appointments";
      }
      throw error;
    }
  }

  async listCollaboratorsWithMetrics(
    companyId: string,
    referenceDate: Date = new Date(),
  ): Promise<{ teamKpis: TeamKpisSummary; collaborators: CollaboratorMetricSummary[] }> {
    const collaborators = await db
      .select()
      .from(CollaboratorTable)
      .where(eq(CollaboratorTable.companyId, companyId))
      .orderBy(CollaboratorTable.name);

    if (collaborators.length === 0) {
      return {
        teamKpis: {
          totalCollaborators: 0,
          activeCollaborators: 0,
          totalCompletedAppointmentsMonth: 0,
          totalRevenueMonthInCents: 0,
          averageTeamRating: 0,
        },
        collaborators: [],
      };
    }

    // Calcula os limites de início e fim do mês de referência em UTC
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    // Carrega os pesos de ranking configurados pelo dono da empresa
    const [companyRow] = await db
      .select({ rankingWeights: CompanyTable.rankingWeights })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);
    const rankingWeights = resolveCompanyRankingWeights(companyRow?.rankingWeights);

    // Consulta agendamentos do mês, vendas de produtos (Estoque), avaliações e troféus em paralelo
    const [companyAppointments, productSalesRows, reviews, awards] = await Promise.all([
      db
        .select({
          id: AppointmentTable.id,
          collaboratorId: AppointmentTable.collaboratorId,
          clientPhone: AppointmentTable.clientPhone,
          servicePriceInCentsSnapshot: AppointmentTable.servicePriceInCentsSnapshot,
          commissionPercentageSnapshot: AppointmentTable.commissionPercentageSnapshot,
          status: AppointmentTable.status,
          startsAt: AppointmentTable.startsAt,
          endsAt: AppointmentTable.endsAt,
          completedAt: AppointmentTable.completedAt,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            gte(AppointmentTable.startsAt, startOfMonth),
            lte(AppointmentTable.startsAt, endOfMonth),
          ),
        ),
      db
        .select({
          collaboratorId: InventoryMovementTable.collaboratorId,
          totalAmountCents: InventoryMovementTable.totalAmountCents,
          quantity: InventoryMovementTable.quantity,
        })
        .from(InventoryMovementTable)
        .where(
          and(
            eq(InventoryMovementTable.companyId, companyId),
            eq(InventoryMovementTable.movementType, "SALE_OUT"),
            isNotNull(InventoryMovementTable.collaboratorId),
            isNull(InventoryMovementTable.reversesMovementId),
            gte(InventoryMovementTable.occurredAt, startOfMonth),
            lte(InventoryMovementTable.occurredAt, endOfMonth),
            sql`not exists (
              select 1 from inventory_movements rev
              where rev.company_id = ${InventoryMovementTable.companyId}
                and rev.reverses_movement_id = ${InventoryMovementTable.id}
            )`,
          ),
        ),
      db
        .select({
          collaboratorId: CollaboratorReviewTable.collaboratorId,
          rating: CollaboratorReviewTable.rating,
        })
        .from(CollaboratorReviewTable)
        .where(eq(CollaboratorReviewTable.companyId, companyId)),
      db
        .select({
          collaboratorId: CollaboratorAwardTable.collaboratorId,
        })
        .from(CollaboratorAwardTable)
        .where(eq(CollaboratorAwardTable.companyId, companyId)),
    ]);

    // Agrupadores por colaborador
    const reviewsMap = new Map<string, number[]>();
    for (const r of reviews) {
      const list = reviewsMap.get(r.collaboratorId) ?? [];
      list.push(r.rating);
      reviewsMap.set(r.collaboratorId, list);
    }

    const awardsCountMap = new Map<string, number>();
    for (const a of awards) {
      awardsCountMap.set(a.collaboratorId, (awardsCountMap.get(a.collaboratorId) ?? 0) + 1);
    }

    // Agregação de vendas de produtos do estoque por colaborador no mês
    let totalProductsSalesTeamInCents = 0;
    const productsSalesMap = new Map<string, { salesInCents: number; soldCount: number }>();
    for (const sale of productSalesRows) {
      if (!sale.collaboratorId) continue;
      totalProductsSalesTeamInCents += sale.totalAmountCents;
      const current = productsSalesMap.get(sale.collaboratorId) ?? { salesInCents: 0, soldCount: 0 };
      current.salesInCents += sale.totalAmountCents;
      current.soldCount += sale.quantity;
      productsSalesMap.set(sale.collaboratorId, current);
    }

    // Mapeamento de agendamentos por colaborador no mês
    let totalServicesRevenueTeamInCents = 0;
    let totalCompletedTeam = 0;
    const monthlyCollabStats = new Map<
      string,
      { completedCount: number; revenueInCents: number; commissionInCents: number; onTimeCount: number }
    >();

    for (const app of companyAppointments) {
      if (app.status === "COMPLETED") {
        totalServicesRevenueTeamInCents += app.servicePriceInCentsSnapshot;
        totalCompletedTeam += 1;

        const current = monthlyCollabStats.get(app.collaboratorId) ?? {
          completedCount: 0,
          revenueInCents: 0,
          commissionInCents: 0,
          onTimeCount: 0,
        };
        current.completedCount += 1;
        current.revenueInCents += app.servicePriceInCentsSnapshot;
        const commissionAmount = Math.round(
          app.servicePriceInCentsSnapshot * (Number(app.commissionPercentageSnapshot) / 100),
        );
        current.commissionInCents += commissionAmount;

        // Verifica pontualidade: se concluído antes ou até o horário de término previsto
        if (app.completedAt && app.completedAt.getTime() <= app.endsAt.getTime() + 10 * 60 * 1000) {
          current.onTimeCount += 1;
        } else {
          current.onTimeCount += 1; // Default pontual se não houver atraso explícito
        }
        monthlyCollabStats.set(app.collaboratorId, current);
      }
    }

    const teamAverageServicesRevenueInCents =
      collaborators.length > 0 ? Math.round(totalServicesRevenueTeamInCents / collaborators.length) : 0;
    const teamAverageProductsSalesInCents =
      collaborators.length > 0 ? Math.round(totalProductsSalesTeamInCents / collaborators.length) : 0;
    const teamAverageCompletedAppointments =
      collaborators.length > 0 ? totalCompletedTeam / collaborators.length : 0;

    // Calcula os indicadores individuais e pontuação de ranking conforme os pesos do dono
    const evaluatedCollaborators: Array<Omit<CollaboratorMetricSummary, "rankingPosition">> = [];

    for (const col of collaborators) {
      const userReviews = reviewsMap.get(col.id) ?? [];
      const totalRev = userReviews.length;
      const avgRat = totalRev > 0 ? userReviews.reduce((sum, n) => sum + n, 0) / totalRev : 0;
      const stats = monthlyCollabStats.get(col.id) ?? {
        completedCount: 0,
        revenueInCents: 0,
        commissionInCents: 0,
        onTimeCount: 0,
      };
      const productStats = productsSalesMap.get(col.id) ?? {
        salesInCents: 0,
        soldCount: 0,
      };

      const punctualityRate =
        stats.completedCount > 0 ? (stats.onTimeCount / stats.completedCount) * 100 : 100;

      const rankingCalc = CollaboratorRankingCalculator.calculate({
        rankingWeights,
        servicesRevenueMonthInCents: stats.revenueInCents,
        monthlyGoalInCents: col.monthlyRevenueGoal,
        teamAverageServicesRevenueInCents,
        productsSalesMonthInCents: productStats.salesInCents,
        teamAverageProductsSalesInCents,
        completedAppointmentsMonth: stats.completedCount,
        teamAverageCompletedAppointments,
        averageRating: totalRev > 0 ? avgRat : null,
        totalReviews: totalRev,
        punctualityRate,
        clientRetentionRate: 85, // Média neutra de retenção estimada caso não haja histórico profundo
      });

      const totalRevenueMonthInCents = stats.revenueInCents + productStats.salesInCents;

      evaluatedCollaborators.push({
        id: col.id,
        companyId: col.companyId,
        name: col.name,
        email: col.email,
        phone: col.phone,
        whatsapp: col.whatsapp,
        specialty: col.specialty,
        bio: col.bio,
        role: "COLLABORATOR" as const,
        commissionPercentage: Number(col.commissionPercentage ?? col.defaultCommissionRate ?? 0),
        defaultCommissionRate: Number(col.defaultCommissionRate ?? col.commissionPercentage ?? 0),
        monthlyRevenueGoal: col.monthlyRevenueGoal,
        hiredAt: new Date(col.hiredAt),
        status: (col.status as CollaboratorStatus) ?? (col.isActive ? "ACTIVE" : "INACTIVE"),
        isActive: col.isActive ?? (col.status === "ACTIVE"),
        avatarUrl: col.avatarUrl,
        completedAppointmentsMonth: stats.completedCount,
        servicesRevenueMonthInCents: stats.revenueInCents,
        productsSalesMonthInCents: productStats.salesInCents,
        productsSoldCountMonth: productStats.soldCount,
        revenueMonthInCents: totalRevenueMonthInCents,
        commissionMonthInCents: stats.commissionInCents,
        averageRating: Math.round(avgRat * 10) / 10,
        totalReviews: totalRev,
        rankingScore: rankingCalc.totalScore,
        rankingPillars: rankingCalc.pillars,
        awardsCount: awardsCountMap.get(col.id) ?? 0,
      });
    }

    // Ordena por nota do ranking decrescente para determinar a posição
    evaluatedCollaborators.sort((a, b) => b.rankingScore - a.rankingScore);

    const resultList: CollaboratorMetricSummary[] = evaluatedCollaborators.map((c, index) => ({
      ...c,
      rankingPosition: index + 1,
    }));

    // Médias consolidadas de equipe
    const activeCollabs = collaborators.filter(
      (c) => (c.status === "ACTIVE" || c.status === null) && c.isActive,
    ).length;

    const allRatings = reviews.map((r) => r.rating);
    const averageTeamRating =
      allRatings.length > 0
        ? Math.round((allRatings.reduce((sum, n) => sum + n, 0) / allRatings.length) * 10) / 10
        : 5.0;

    const teamKpis: TeamKpisSummary = {
      totalCollaborators: collaborators.length,
      activeCollaborators: activeCollabs,
      totalCompletedAppointmentsMonth: totalCompletedTeam,
      totalRevenueMonthInCents: totalServicesRevenueTeamInCents + totalProductsSalesTeamInCents,
      averageTeamRating,
    };

    return { teamKpis, collaborators: resultList };
  }

  async getProfileDossier(
    collaboratorId: string,
    companyId: string,
    referenceDate: Date = new Date(),
  ): Promise<CollaboratorProfileDossier | null> {
    const [collabRow] = await db
      .select()
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!collabRow) return null;

    const collaboratorRecord: CollaboratorRecord = {
      ...collabRow,
      commissionPercentage: Number(
        collabRow.commissionPercentage ?? collabRow.defaultCommissionRate ?? 0,
      ),
      defaultCommissionRate: Number(
        collabRow.defaultCommissionRate ?? collabRow.commissionPercentage ?? 0,
      ),
      status: (collabRow.status as CollaboratorStatus) ?? (collabRow.isActive ? "ACTIVE" : "INACTIVE"),
      isActive: collabRow.isActive ?? (collabRow.status === "ACTIVE"),
      hiredAt: new Date(collabRow.hiredAt),
      deactivatedAt: collabRow.deactivatedAt ? new Date(collabRow.deactivatedAt) : null,
      createdAt: new Date(collabRow.createdAt),
      updatedAt: new Date(collabRow.updatedAt),
    };

    // Antiguidade
    const diffMs = referenceDate.getTime() - collaboratorRecord.hiredAt.getTime();
    const tenureMonths = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375)));
    const tenureFormatted = formatTenure(tenureMonths);

    // Avaliações
    const reviewsRows = await db
      .select()
      .from(CollaboratorReviewTable)
      .where(
        and(
          eq(CollaboratorReviewTable.companyId, companyId),
          eq(CollaboratorReviewTable.collaboratorId, collaboratorId),
        ),
      )
      .orderBy(desc(CollaboratorReviewTable.createdAt))
      .limit(10);

    const recentReviews: CollaboratorReviewRecord[] = reviewsRows.map((r) => ({
      id: r.id,
      clientName: r.clientName,
      serviceName: r.serviceName,
      rating: r.rating,
      comment: r.comment,
      createdAt: new Date(r.createdAt),
    }));

    const totalReviews = reviewsRows.length;
    const averageRating =
      totalReviews > 0
        ? Math.round(
            (reviewsRows.reduce((sum, item) => sum + item.rating, 0) / totalReviews) * 10,
          ) / 10
        : 0;

    // Troféus / Conquistas
    const awardsRows = await db
      .select()
      .from(CollaboratorAwardTable)
      .where(
        and(
          eq(CollaboratorAwardTable.companyId, companyId),
          eq(CollaboratorAwardTable.collaboratorId, collaboratorId),
        ),
      )
      .orderBy(desc(CollaboratorAwardTable.createdAt));

    const awards: CollaboratorAwardRecord[] = awardsRows.map((a) => ({
      id: a.id,
      title: a.title,
      referenceMonth: a.referenceMonth,
      score: Number(a.score),
      createdAt: new Date(a.createdAt),
    }));

    // Serviços vinculados
    const serviceRows = await db
      .select({
        serviceId: ServiceTable.id,
        name: ServiceTable.name,
        priceInCents: ServiceTable.priceInCents,
        durationMinutes: ServiceTable.durationMinutes,
        customCommissionRate: CollaboratorServiceTable.customCommissionRate,
        commissionPercentage: CollaboratorServiceTable.commissionPercentage,
      })
      .from(CollaboratorServiceTable)
      .innerJoin(ServiceTable, eq(CollaboratorServiceTable.serviceId, ServiceTable.id))
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
        ),
      );

    const services: CollaboratorLinkedServiceRecord[] = serviceRows.map((s) => {
      const customRate = s.customCommissionRate !== null ? Number(s.customCommissionRate) : null;
      const effective = customRate ?? collaboratorRecord.defaultCommissionRate;
      return {
        serviceId: s.serviceId,
        name: s.name,
        priceInCents: s.priceInCents,
        durationMinutes: s.durationMinutes,
        customCommissionRate: customRate,
        effectiveCommissionRate: effective,
      };
    });

    // Jornada semanal individual (consulta collaborator_schedules ou work_schedules)
    const scheduleRows = await db
      .select()
      .from(CollaboratorScheduleTable)
      .where(
        and(
          eq(CollaboratorScheduleTable.companyId, companyId),
          eq(CollaboratorScheduleTable.collaboratorId, collaboratorId),
        ),
      )
      .orderBy(CollaboratorScheduleTable.dayOfWeek);

    let schedules: CollaboratorDayScheduleInput[] = [];
    if (scheduleRows.length > 0) {
      schedules = scheduleRows.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        isWorkingDay: s.isWorkingDay,
        startTime: s.startTime,
        endTime: s.endTime,
        breakStartTime: s.breakStartTime,
        breakEndTime: s.breakEndTime,
      }));
    } else {
      // Fallback para work_schedules
      const legacySchedules = await db
        .select()
        .from(WorkScheduleTable)
        .where(
          and(
            eq(WorkScheduleTable.companyId, companyId),
            eq(WorkScheduleTable.collaboratorId, collaboratorId),
          ),
        )
        .orderBy(WorkScheduleTable.dayOfWeek);

      schedules = legacySchedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        isWorkingDay: s.isWorkingDay,
        startTime: s.startTime,
        endTime: s.endTime,
        breakStartTime: s.breakStart,
        breakEndTime: s.breakEnd,
      }));
    }

    // Estatísticas de agendamento (mês e histórico total)
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    const startOfMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));

    const [allCollabAppointments, companyRow, metricsResult] = await Promise.all([
      db
        .select({
          servicePriceInCentsSnapshot: AppointmentTable.servicePriceInCentsSnapshot,
          commissionPercentageSnapshot: AppointmentTable.commissionPercentageSnapshot,
          status: AppointmentTable.status,
          startsAt: AppointmentTable.startsAt,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.collaboratorId, collaboratorId),
          ),
        ),
      db
        .select({ rankingWeights: CompanyTable.rankingWeights })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, companyId))
        .limit(1)
        .then((rows) => rows[0]),
      this.listCollaboratorsWithMetrics(companyId, referenceDate),
    ]);

    const rankingWeights = resolveCompanyRankingWeights(companyRow?.rankingWeights);

    let completedAppointmentsMonth = 0;
    let totalCompletedAppointments = 0;
    let servicesRevenueMonthInCents = 0;
    let totalRevenueInCents = 0;
    let commissionMonthInCents = 0;
    let totalCommissionInCents = 0;

    for (const app of allCollabAppointments) {
      if (app.status === "COMPLETED") {
        totalCompletedAppointments += 1;
        totalRevenueInCents += app.servicePriceInCentsSnapshot;
        const commVal = Math.round(
          app.servicePriceInCentsSnapshot * (Number(app.commissionPercentageSnapshot) / 100),
        );
        totalCommissionInCents += commVal;

        if (app.startsAt >= startOfMonth && app.startsAt <= endOfMonth) {
          completedAppointmentsMonth += 1;
          servicesRevenueMonthInCents += app.servicePriceInCentsSnapshot;
          commissionMonthInCents += commVal;
        }
      }
    }

    const foundRank = metricsResult.collaborators.find((c) => c.id === collaboratorId);
    const productsSalesMonthInCents = foundRank?.productsSalesMonthInCents ?? 0;
    const productsSoldCountMonth = foundRank?.productsSoldCountMonth ?? 0;
    const revenueMonthInCents = servicesRevenueMonthInCents + productsSalesMonthInCents;
    const position = foundRank?.rankingPosition ?? 1;

    // Fallback seguro caso rankingPillars não esteja presente no item consolidado
    const fallbackRankingCalc = CollaboratorRankingCalculator.calculate({
      rankingWeights,
      servicesRevenueMonthInCents,
      monthlyGoalInCents: collaboratorRecord.monthlyRevenueGoal ?? null,
      teamAverageServicesRevenueInCents: servicesRevenueMonthInCents,
      productsSalesMonthInCents,
      teamAverageProductsSalesInCents: productsSalesMonthInCents,
      completedAppointmentsMonth,
      teamAverageCompletedAppointments: completedAppointmentsMonth,
      averageRating: totalReviews > 0 ? averageRating : null,
      totalReviews,
      punctualityRate: 95,
      clientRetentionRate: 85,
    });

    return {
      collaborator: collaboratorRecord,
      tenureFormatted,
      tenureMonths,
      ranking: {
        totalScore: foundRank?.rankingScore ?? fallbackRankingCalc.totalScore,
        position,
        totalInCompany: metricsResult.collaborators.length,
        weights: rankingWeights,
        pillars: foundRank?.rankingPillars ?? fallbackRankingCalc.pillars,
      },
      stats: {
        completedAppointmentsMonth,
        totalCompletedAppointments,
        servicesRevenueMonthInCents,
        productsSalesMonthInCents,
        productsSoldCountMonth,
        revenueMonthInCents,
        totalRevenueInCents,
        commissionMonthInCents,
        totalCommissionInCents,
        averageRating,
        totalReviews,
      },
      awards,
      recentReviews,
      services,
      schedules,
    };
  }

  async syncServices(
    collaboratorId: string,
    companyId: string,
    services: Array<{ serviceId: string; customCommissionRate?: number | null }>,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(CollaboratorServiceTable)
        .where(
          and(
            eq(CollaboratorServiceTable.companyId, companyId),
            eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
          ),
        );

      if (services.length > 0) {
        await tx.insert(CollaboratorServiceTable).values(
          services.map((s) => ({
            companyId,
            collaboratorId,
            serviceId: s.serviceId,
            customCommissionRate:
              s.customCommissionRate !== undefined && s.customCommissionRate !== null
                ? s.customCommissionRate
                : null,
            commissionPercentage:
              s.customCommissionRate !== undefined && s.customCommissionRate !== null
                ? s.customCommissionRate
                : 0,
          })),
        );
      }
    });
  }

  async syncSchedules(
    collaboratorId: string,
    companyId: string,
    schedules: CollaboratorDayScheduleInput[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      // 1. Limpa e recria em collaborator_schedules
      await tx
        .delete(CollaboratorScheduleTable)
        .where(
          and(
            eq(CollaboratorScheduleTable.companyId, companyId),
            eq(CollaboratorScheduleTable.collaboratorId, collaboratorId),
          ),
        );

      if (schedules.length > 0) {
        await tx.insert(CollaboratorScheduleTable).values(
          schedules.map((s) => ({
            companyId,
            collaboratorId,
            dayOfWeek: s.dayOfWeek,
            isWorkingDay: s.isWorkingDay,
            startTime: s.startTime ?? null,
            endTime: s.endTime ?? null,
            breakStartTime: s.breakStartTime ?? null,
            breakEndTime: s.breakEndTime ?? null,
          })),
        );
      }

      // 2. Sincroniza em work_schedules para compatibilidade com o motor de agendamentos existente
      await tx
        .delete(WorkScheduleTable)
        .where(
          and(
            eq(WorkScheduleTable.companyId, companyId),
            eq(WorkScheduleTable.collaboratorId, collaboratorId),
          ),
        );

      if (schedules.length > 0) {
        await tx.insert(WorkScheduleTable).values(
          schedules.map((s) => ({
            companyId,
            collaboratorId,
            dayOfWeek: s.dayOfWeek,
            isWorkingDay: s.isWorkingDay,
            startTime: s.startTime ?? null,
            endTime: s.endTime ?? null,
            breakStart: s.breakStartTime ?? null,
            breakEnd: s.breakEndTime ?? null,
          })),
        );
      }
    });
  }

  async countFutureAppointments(collaboratorId: string, companyId: string): Promise<number> {
    const rows = await db
      .select({ id: AppointmentTable.id })
      .from(AppointmentTable)
      .where(
        and(
          eq(AppointmentTable.companyId, companyId),
          eq(AppointmentTable.collaboratorId, collaboratorId),
          gte(AppointmentTable.startsAt, new Date()),
          inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
        ),
      );

    return rows.length;
  }

  async deactivateAndQueueReschedule(
    collaboratorId: string,
    companyId: string,
    reason?: string | null,
    queueAi = true,
  ): Promise<{ queuedCount: number }> {
    let queuedCount = 0;

    await db.transaction(async (tx) => {
      // 1. Desativação lógica do colaborador
      await tx
        .update(CollaboratorTable)
        .set({
          status: "INACTIVE",
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(CollaboratorTable.id, collaboratorId),
            eq(CollaboratorTable.companyId, companyId),
          ),
        );

      // 2. Se solicitado reagendamento com IA, busca e enfileira as sessões futuras
      if (queueAi) {
        const futureAppointments = await tx
          .select({
            id: AppointmentTable.id,
            clientId: sql<string | null>`NULL`,
            clientName: AppointmentTable.clientName,
            clientPhone: AppointmentTable.clientPhone,
            serviceId: AppointmentTable.serviceId,
            startsAt: AppointmentTable.startsAt,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, companyId),
              eq(AppointmentTable.collaboratorId, collaboratorId),
              gte(AppointmentTable.startsAt, new Date()),
              inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
            ),
          );

        for (const app of futureAppointments) {
          // Busca outros profissionais ativos da mesma empresa habilitados para este serviço
          const suggestedRows = await tx
            .select({ id: CollaboratorTable.id })
            .from(CollaboratorTable)
            .innerJoin(
              CollaboratorServiceTable,
              and(
                eq(CollaboratorTable.id, CollaboratorServiceTable.collaboratorId),
                eq(CollaboratorTable.companyId, CollaboratorServiceTable.companyId),
              ),
            )
            .where(
              and(
                eq(CollaboratorTable.companyId, companyId),
                eq(CollaboratorTable.status, "ACTIVE"),
                eq(CollaboratorTable.isActive, true),
                eq(CollaboratorServiceTable.serviceId, app.serviceId),
                sql`${CollaboratorTable.id} != ${collaboratorId}`,
              ),
            );

          const suggestedIds = suggestedRows.map((r) => r.id);

          await tx.insert(AiRescheduleQueueTable).values({
            companyId,
            formerCollaboratorId: collaboratorId,
            appointmentId: app.id,
            clientId: app.clientId,
            clientName: app.clientName,
            clientPhone: app.clientPhone,
            serviceId: app.serviceId,
            originalStartsAt: app.startsAt,
            suggestedCollaboratorIds: suggestedIds,
            status: "PENDING_AI_AGENT",
          });

          queuedCount += 1;
        }
      }
    });

    return { queuedCount };
  }

  async closeMonthAward(
    companyId: string,
    referenceMonth: string,
  ): Promise<CloseMonthAwardResult> {
    // Verifica duplicidade antes de calcular o ranking do mês de referência
    const [existing] = await db
      .select({ id: CollaboratorAwardTable.id })
      .from(CollaboratorAwardTable)
      .where(
        and(
          eq(CollaboratorAwardTable.companyId, companyId),
          eq(CollaboratorAwardTable.referenceMonth, referenceMonth),
        ),
      )
      .limit(1);

    if (existing) {
      throw new AwardAlreadyClosedError(referenceMonth);
    }

    const [yearStr, monthStr] = referenceMonth.split("-");
    const referenceDate = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, 15, 12, 0, 0));

    const { collaborators } = await this.listCollaboratorsWithMetrics(companyId, referenceDate);
    if (collaborators.length === 0) {
      throw new NoCollaboratorsToAwardError();
    }

    // Prioriza o #1 entre colaboradores ativos; fallback para #1 geral se todos estiverem inativos
    const winner = collaborators.find((c) => c.isActive) ?? collaborators[0]!;
    const title = "Funcionário do Mês";

    try {
      const [created] = await db
        .insert(CollaboratorAwardTable)
        .values({
          companyId,
          collaboratorId: winner.id,
          title,
          referenceMonth,
          score: winner.rankingScore,
        })
        .returning();

      return {
        id: created!.id,
        companyId: created!.companyId,
        collaboratorId: created!.collaboratorId,
        collaboratorName: winner.name,
        title: created!.title,
        referenceMonth: created!.referenceMonth,
        score: Number(created!.score),
        createdAt: new Date(created!.createdAt),
      };
    } catch (error) {
      if (isUniqueViolationError(error)) {
        throw new AwardAlreadyClosedError(referenceMonth);
      }
      throw error;
    }
  }
}
