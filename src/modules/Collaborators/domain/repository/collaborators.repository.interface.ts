import type { CompanyRankingWeights } from "../../../Company/domain/ranking-weights.js";
import type { CollaboratorEntity, CollaboratorStatus } from "../entities/collaborator.entity.js";
import type { RankingPillarsBreakdown } from "../services/collaborator-ranking-calculator.service.js";
import type { CollaboratorDayScheduleInput } from "../services/collaborator-schedule-validator.service.js";

export interface CollaboratorRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly whatsapp?: string | null | undefined;
  readonly specialty: string;
  readonly bio?: string | null | undefined;
  readonly commissionPercentage: number;
  readonly defaultCommissionRate: number;
  readonly monthlyRevenueGoal?: number | null | undefined;
  readonly status: CollaboratorStatus;
  readonly isActive: boolean;
  readonly avatarUrl?: string | null | undefined;
  readonly hiredAt: Date;
  readonly deactivatedAt?: Date | null | undefined;
  readonly deactivationReason?: string | null | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CollaboratorMetricSummary {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly whatsapp?: string | null | undefined;
  readonly avatarUrl: string | null;
  readonly specialty: string;
  readonly bio?: string | null | undefined;
  readonly status: CollaboratorStatus;
  readonly isActive: boolean;
  readonly role: "COLLABORATOR";
  readonly commissionPercentage: number;
  readonly defaultCommissionRate: number;
  readonly monthlyRevenueGoal?: number | null | undefined;
  readonly hiredAt: Date;
  readonly completedAppointmentsMonth: number;
  readonly servicesRevenueMonthInCents: number;
  readonly productsSalesMonthInCents: number;
  readonly productsSoldCountMonth: number;
  readonly revenueMonthInCents: number;
  readonly commissionMonthInCents: number;
  readonly averageRating: number;
  readonly totalReviews: number;
  readonly rankingPosition: number;
  readonly rankingScore: number;
  readonly rankingPillars?: RankingPillarsBreakdown;
  readonly awardsCount: number;
}

export interface TeamKpisSummary {
  readonly totalCollaborators: number;
  readonly activeCollaborators: number;
  readonly totalCompletedAppointmentsMonth: number;
  readonly totalRevenueMonthInCents: number;
  readonly averageTeamRating: number;
}

export interface CollaboratorReviewRecord {
  readonly id: string;
  readonly clientName: string;
  readonly serviceName: string | null;
  readonly rating: number;
  readonly comment: string | null;
  readonly createdAt: Date;
}

export interface CollaboratorAwardRecord {
  readonly id: string;
  readonly title: string;
  readonly referenceMonth: string;
  readonly score: number;
  readonly createdAt: Date;
}

export interface CollaboratorLinkedServiceRecord {
  readonly serviceId: string;
  readonly name: string;
  readonly priceInCents: number;
  readonly durationMinutes: number;
  readonly customCommissionRate: number | null;
  readonly effectiveCommissionRate: number;
}

export interface CollaboratorProfileDossier {
  readonly collaborator: CollaboratorRecord;
  readonly tenureFormatted: string;
  readonly tenureMonths: number;
  readonly ranking: {
    readonly totalScore: number;
    readonly position: number;
    readonly totalInCompany: number;
    readonly weights: CompanyRankingWeights;
    readonly pillars: RankingPillarsBreakdown;
  };
  readonly stats: {
    readonly completedAppointmentsMonth: number;
    readonly totalCompletedAppointments: number;
    readonly servicesRevenueMonthInCents: number;
    readonly productsSalesMonthInCents: number;
    readonly productsSoldCountMonth: number;
    readonly revenueMonthInCents: number;
    readonly totalRevenueInCents: number;
    readonly commissionMonthInCents: number;
    readonly totalCommissionInCents: number;
    readonly averageRating: number;
    readonly totalReviews: number;
  };
  readonly awards: CollaboratorAwardRecord[];
  readonly recentReviews: CollaboratorReviewRecord[];
  readonly services: CollaboratorLinkedServiceRecord[];
  readonly schedules: CollaboratorDayScheduleInput[];
}

export interface CollaboratorsRepository {
  existsByEmail(email: string): Promise<boolean>;
  companyExistsById(companyId: string): Promise<boolean>;
  save(collaborator: CollaboratorEntity): Promise<void>;
  findById(collaboratorId: string, companyId: string): Promise<CollaboratorEntity | null>;
  findAllByCompanyId(
    companyId: string,
    filters?: { serviceId?: string | undefined; status?: CollaboratorStatus | undefined },
  ): Promise<CollaboratorRecord[]>;
  update(collaborator: CollaboratorEntity): Promise<void>;
  updateStatusInCompany(
    collaboratorId: string,
    companyId: string,
    isActive: boolean,
  ): Promise<CollaboratorRecord | null>;
  updateDetailsInCompany?(
    collaboratorId: string,
    companyId: string,
    data: { name?: string | undefined; specialty?: string | undefined; commissionPercentage?: number | undefined },
  ): Promise<CollaboratorRecord | null>;
  deleteInCompany?(
    collaboratorId: string,
    companyId: string,
    transferToCollaboratorId?: string | undefined,
  ): Promise<"deleted" | "not_found" | "has_appointments" | "destination_not_found">;

  listCollaboratorsWithMetrics(
    companyId: string,
    referenceDate?: Date,
  ): Promise<{ teamKpis: TeamKpisSummary; collaborators: CollaboratorMetricSummary[] }>;
  getProfileDossier(
    collaboratorId: string,
    companyId: string,
    referenceDate?: Date,
  ): Promise<CollaboratorProfileDossier | null>;
  syncServices(
    collaboratorId: string,
    companyId: string,
    services: Array<{ serviceId: string; customCommissionRate?: number | null | undefined }>,
  ): Promise<void>;
  syncSchedules(
    collaboratorId: string,
    companyId: string,
    schedules: CollaboratorDayScheduleInput[],
  ): Promise<void>;
  countFutureAppointments(collaboratorId: string, companyId: string): Promise<number>;
  deactivateAndQueueReschedule(
    collaboratorId: string,
    companyId: string,
    reason?: string | null | undefined,
    queueAi?: boolean,
  ): Promise<{ queuedCount: number }>;
  closeMonthAward?(
    companyId: string,
    referenceMonth: string,
  ): Promise<CloseMonthAwardResult>;
}

export interface CloseMonthAwardResult {
  readonly id: string;
  readonly companyId: string;
  readonly collaboratorId: string;
  readonly collaboratorName: string;
  readonly title: string;
  readonly referenceMonth: string;
  readonly score: number;
  readonly createdAt: Date;
}
