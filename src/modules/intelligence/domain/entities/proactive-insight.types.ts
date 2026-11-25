import type {
  AiProactiveInsightModule,
  AiProactiveInsightStatus,
} from "../../../billing/infra/database/schema/ai-proactive-insights-schema.js";

export const INTELLIGENCE_MODULES = [
  "AGENDA",
  "FINANCE",
  "CLIENTS",
  "SERVICES",
  "INVENTORY",
  "TEAM",
] as const;

export type IntelligenceModule = (typeof INTELLIGENCE_MODULES)[number];

export type RetentionTrack =
  | "TRACK_1_SATISFIED"
  | "TRACK_2_CANCELED"
  | "TRACK_3_UNHAPPY";

export interface ProactiveInsightRecord {
  id: string;
  tenantId: string;
  module: AiProactiveInsightModule;
  type: string;
  title: string;
  description: string;
  impactLabel: string | null;
  actionPayload: Record<string, unknown> | null;
  status: AiProactiveInsightStatus;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreateProactiveInsightRecordInput {
  tenantId: string;
  module: AiProactiveInsightModule;
  type: string;
  title: string;
  description: string;
  impactLabel?: string | null | undefined;
  actionPayload?: Record<string, unknown> | null | undefined;
  expiresAt?: Date | null | undefined;
}

export interface InactiveClientCandidate {
  clientId: string;
  clientName: string;
  clientPhone: string;
  lastCompletedAt: Date | null;
  daysSinceLastVisit: number;
  lastAppointmentStatus: string | null;
  lastCancellationReason: string | null;
  lastServiceName: string | null;
  preferredCollaboratorName: string | null;
  lastReviewRating: number | null;
  lastReviewComment: string | null;
}

export interface AgendaGapSummary {
  collaboratorId: string;
  collaboratorName: string;
  totalAvailableMinutes48h: number;
  bookedMinutes48h: number;
  idlePercentage: number;
  habitualClients: Array<{
    clientName: string;
    clientPhone: string;
  }>;
}

export interface FinanceWeeklyComparison {
  currentWeekRevenueCents: number;
  previousWeekRevenueCents: number;
  revenueDeltaPercent: number;
  currentWeekAvgTicketCents: number;
  previousWeekAvgTicketCents: number;
  currentWeekOrdersCount: number;
  previousWeekOrdersCount: number;
  pendingExpensesCents: number;
  peakDayOfWeek: string | null;
}

export interface ServiceComboCandidate {
  serviceA: string;
  serviceB: string;
  coOccurrenceCount: number;
}

export interface InventoryAlertSummary {
  lowStockItems: Array<{
    id: string;
    name: string;
    currentStock: number;
    minStock: number;
  }>;
  stagnantItems60d: Array<{
    id: string;
    name: string;
    currentStock: number;
    salePriceCents: number | null;
  }>;
}

export interface TeamPerformanceSummary {
  collaboratorId: string;
  collaboratorName: string;
  completedAppointments30d: number;
  returnRatePercent: number;
  averageRating: number | null;
  reviewsCount: number;
  idlePercentage48h: number;
}

export interface ClientsRetentionMetrics {
  totalClients: number;
  inactive30dCount: number;
  avgTotalSpentCents: number;
  recentUnhappyReviewsCount: number;
}

export interface ProactiveScanMetrics {
  companyId: string;
  companyName: string;
  referenceDate: string;
  agendaGaps: AgendaGapSummary[];
  finance: FinanceWeeklyComparison;
  serviceCombos: ServiceComboCandidate[];
  inventory: InventoryAlertSummary;
  team: TeamPerformanceSummary[];
  clients: ClientsRetentionMetrics;
}

export interface ModuleMetricsPayload {
  module: IntelligenceModule;
  companyName: string;
  referenceDate: string;
  metrics: Record<string, unknown>;
}

export interface DailyBriefingSnapshot {
  companyId: string;
  companyName: string;
  companyTimezone: string;
  ownerPhone: string | null;
  referenceDate: string;
  confirmedAppointmentsToday: number;
  pendingAppointmentsToday: number;
  projectedRevenueTodayCents: number;
  criticalIdleSlotsCount: number;
  criticalIdleSummary: string[];
  pendingInsightsCount: number;
}
