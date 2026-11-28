import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { SaasTelemetryTable } from "../../../billing/infra/database/schema/saas-telemetry-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { CollaboratorTable } from "../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import {
  ClientSubscriptionTable,
  CompanyPaymentConfigTable,
  PaymentChargeTable,
} from "../../../payments/infra/database/schema/payments-schema.js";
import { ServiceTable } from "../../../services/infra/database/schema/services-schema.js";

export type SaasPlan = "ESSENTIAL" | "PRO" | "SCALE";
export type SaasStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED";

export interface PlatformOverviewOutput {
  totalTenants: number;
  activeTenants: number;
  suspendedTenants: number;
  totalAppointments: number;
  activeVipSubscribers: number;
  totalTransactedCents: number;
  totalAiTurns: number;
  byPlan: Record<SaasPlan, number>;
  byStatus: Record<SaasStatus, number>;
}

export interface AdminTenantListItem {
  id: string;
  companyName: string;
  slug: string;
  ownerName: string;
  email: string;
  phone: string;
  isActive: boolean;
  saasPlan: SaasPlan;
  saasStatus: SaasStatus;
  currency: string;
  timezone: string;
  paymentProvider: string;
  appointmentsCount: number;
  activeSubscribersCount: number;
  transactedCents: number;
  createdAt: string;
}

export interface AdminTenantDetailsOutput extends AdminTenantListItem {
  monthlyAiQuota: number;
  collaboratorsCount: number;
  servicesCount: number;
  clientsCount: number;
  completedAppointmentsCount: number;
  totalAiTurns: number;
  paymentAccountLabel: string | null;
}

export class SuperAdminRepository {
  async getOverview(): Promise<PlatformOverviewOutput> {
    const [
      companies,
      [apptTotals],
      [subTotals],
      [chargeTotals],
      [telemetryTotals],
    ] = await Promise.all([
      db
        .select({
          isActive: CompanyTable.isActive,
          saasPlan: CompanyTable.saasPlan,
          saasStatus: CompanyTable.saasStatus,
        })
        .from(CompanyTable),
      db
        .select({
          total: sql<number>`count(*)::int`,
        })
        .from(AppointmentTable),
      db
        .select({
          total: sql<number>`count(*)::int`,
        })
        .from(ClientSubscriptionTable)
        .where(eq(ClientSubscriptionTable.status, "ACTIVE")),
      db
        .select({
          totalCents: sql<number>`coalesce(sum(${PaymentChargeTable.amountCents}), 0)::bigint`,
        })
        .from(PaymentChargeTable)
        .where(eq(PaymentChargeTable.status, "CONFIRMED")),
      db
        .select({
          gmvCents: sql<number>`coalesce(sum(${SaasTelemetryTable.gmvCents}), 0)::bigint`,
          aiTurns: sql<number>`coalesce(sum(${SaasTelemetryTable.aiTurnsL0} + ${SaasTelemetryTable.aiTurnsL1} + ${SaasTelemetryTable.aiTurnsL2}), 0)::bigint`,
        })
        .from(SaasTelemetryTable),
    ]);

    const byPlan: Record<SaasPlan, number> = { ESSENTIAL: 0, PRO: 0, SCALE: 0 };
    const byStatus: Record<SaasStatus, number> = {
      TRIAL: 0,
      ACTIVE: 0,
      PAST_DUE: 0,
      CANCELED: 0,
    };

    let activeTenants = 0;
    for (const c of companies) {
      if (c.isActive) activeTenants += 1;
      byPlan[c.saasPlan] = (byPlan[c.saasPlan] ?? 0) + 1;
      byStatus[c.saasStatus] = (byStatus[c.saasStatus] ?? 0) + 1;
    }

    const totalChargesCents = Number(chargeTotals?.totalCents ?? 0);
    const telemetryGmvCents = Number(telemetryTotals?.gmvCents ?? 0);

    return {
      totalTenants: companies.length,
      activeTenants,
      suspendedTenants: companies.length - activeTenants,
      totalAppointments: Number(apptTotals?.total ?? 0),
      activeVipSubscribers: Number(subTotals?.total ?? 0),
      totalTransactedCents: Math.max(totalChargesCents, telemetryGmvCents),
      totalAiTurns: Number(telemetryTotals?.aiTurns ?? 0),
      byPlan,
      byStatus,
    };
  }

  async listTenants(filters: {
    search?: string | undefined;
    saasPlan?: SaasPlan | undefined;
    saasStatus?: SaasStatus | undefined;
    isActive?: boolean | undefined;
  }): Promise<AdminTenantListItem[]> {
    const conditions = [];
    if (filters.saasPlan) conditions.push(eq(CompanyTable.saasPlan, filters.saasPlan));
    if (filters.saasStatus) conditions.push(eq(CompanyTable.saasStatus, filters.saasStatus));
    if (typeof filters.isActive === "boolean") {
      conditions.push(eq(CompanyTable.isActive, filters.isActive));
    }
    if (filters.search?.trim()) {
      const pattern = `%${filters.search.trim()}%`;
      conditions.push(
        or(
          ilike(CompanyTable.companyName, pattern),
          ilike(CompanyTable.slug, pattern),
          ilike(CompanyTable.email, pattern),
          ilike(CompanyTable.name, pattern),
        )!,
      );
    }

    const [companies, apptCounts, subCounts, chargeSums, paymentConfigs] =
      await Promise.all([
        db
          .select({
            id: CompanyTable.id,
            companyName: CompanyTable.companyName,
            slug: CompanyTable.slug,
            ownerName: CompanyTable.name,
            email: CompanyTable.email,
            phone: CompanyTable.phone,
            isActive: CompanyTable.isActive,
            saasPlan: CompanyTable.saasPlan,
            saasStatus: CompanyTable.saasStatus,
            currency: CompanyTable.currency,
            timezone: CompanyTable.timezone,
            createdAt: CompanyTable.createdAt,
          })
          .from(CompanyTable)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(CompanyTable.createdAt))
          .limit(200),
        db
          .select({
            companyId: AppointmentTable.companyId,
            total: sql<number>`count(*)::int`,
          })
          .from(AppointmentTable)
          .groupBy(AppointmentTable.companyId),
        db
          .select({
            companyId: ClientSubscriptionTable.companyId,
            total: sql<number>`count(*)::int`,
          })
          .from(ClientSubscriptionTable)
          .where(eq(ClientSubscriptionTable.status, "ACTIVE"))
          .groupBy(ClientSubscriptionTable.companyId),
        db
          .select({
            companyId: PaymentChargeTable.companyId,
            totalCents: sql<number>`coalesce(sum(${PaymentChargeTable.amountCents}), 0)::bigint`,
          })
          .from(PaymentChargeTable)
          .where(eq(PaymentChargeTable.status, "CONFIRMED"))
          .groupBy(PaymentChargeTable.companyId),
        db
          .select({
            companyId: CompanyPaymentConfigTable.companyId,
            paymentProvider: CompanyPaymentConfigTable.paymentProvider,
          })
          .from(CompanyPaymentConfigTable),
      ]);

    const apptsByCompany = new Map(apptCounts.map((r) => [r.companyId, Number(r.total)]));
    const subsByCompany = new Map(subCounts.map((r) => [r.companyId, Number(r.total)]));
    const centsByCompany = new Map(chargeSums.map((r) => [r.companyId, Number(r.totalCents)]));
    const providerByCompany = new Map(
      paymentConfigs.map((r) => [r.companyId, r.paymentProvider]),
    );

    return companies.map((company) => ({
      id: company.id,
      companyName: company.companyName,
      slug: company.slug,
      ownerName: company.ownerName,
      email: company.email,
      phone: company.phone,
      isActive: company.isActive,
      saasPlan: company.saasPlan,
      saasStatus: company.saasStatus,
      currency: company.currency,
      timezone: company.timezone,
      paymentProvider: providerByCompany.get(company.id) ?? "NONE",
      appointmentsCount: apptsByCompany.get(company.id) ?? 0,
      activeSubscribersCount: subsByCompany.get(company.id) ?? 0,
      transactedCents: centsByCompany.get(company.id) ?? 0,
      createdAt: company.createdAt.toISOString(),
    }));
  }

  async getTenantDetails(companyId: string): Promise<AdminTenantDetailsOutput | null> {
    const [company] = await db
      .select()
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);
    if (!company) return null;

    const [
      [apptStats],
      [subCount],
      [chargeSum],
      [collabCount],
      [svcCount],
      [clientCount],
      [paymentConfig],
      [telemetry],
    ] = await Promise.all([
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${AppointmentTable.status} = 'COMPLETED')::int`,
        })
        .from(AppointmentTable)
        .where(eq(AppointmentTable.companyId, companyId)),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(ClientSubscriptionTable)
        .where(
          and(
            eq(ClientSubscriptionTable.companyId, companyId),
            eq(ClientSubscriptionTable.status, "ACTIVE"),
          ),
        ),
      db
        .select({
          totalCents: sql<number>`coalesce(sum(${PaymentChargeTable.amountCents}), 0)::bigint`,
        })
        .from(PaymentChargeTable)
        .where(
          and(
            eq(PaymentChargeTable.companyId, companyId),
            eq(PaymentChargeTable.status, "CONFIRMED"),
          ),
        ),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.companyId, companyId)),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(ServiceTable)
        .where(eq(ServiceTable.companyId, companyId)),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(ClientTable)
        .where(eq(ClientTable.companyId, companyId)),
      db
        .select({
          paymentProvider: CompanyPaymentConfigTable.paymentProvider,
          providerAccountLabel: CompanyPaymentConfigTable.providerAccountLabel,
        })
        .from(CompanyPaymentConfigTable)
        .where(eq(CompanyPaymentConfigTable.companyId, companyId))
        .limit(1),
      db
        .select({
          aiTurns: sql<number>`coalesce(sum(${SaasTelemetryTable.aiTurnsL0} + ${SaasTelemetryTable.aiTurnsL1} + ${SaasTelemetryTable.aiTurnsL2}), 0)::bigint`,
        })
        .from(SaasTelemetryTable)
        .where(eq(SaasTelemetryTable.companyId, companyId)),
    ]);

    return {
      id: company.id,
      companyName: company.companyName,
      slug: company.slug,
      ownerName: company.name,
      email: company.email,
      phone: company.phone,
      isActive: company.isActive,
      saasPlan: company.saasPlan,
      saasStatus: company.saasStatus,
      currency: company.currency,
      timezone: company.timezone,
      monthlyAiQuota: company.monthlyAiQuota,
      paymentProvider: paymentConfig?.paymentProvider ?? "NONE",
      paymentAccountLabel: paymentConfig?.providerAccountLabel ?? null,
      appointmentsCount: Number(apptStats?.total ?? 0),
      completedAppointmentsCount: Number(apptStats?.completed ?? 0),
      activeSubscribersCount: Number(subCount?.total ?? 0),
      transactedCents: Number(chargeSum?.totalCents ?? 0),
      collaboratorsCount: Number(collabCount?.total ?? 0),
      servicesCount: Number(svcCount?.total ?? 0),
      clientsCount: Number(clientCount?.total ?? 0),
      totalAiTurns: Number(telemetry?.aiTurns ?? 0),
      createdAt: company.createdAt.toISOString(),
    };
  }

  async updateTenantStatus(
    companyId: string,
    patch: {
      isActive?: boolean | undefined;
      saasStatus?: SaasStatus | undefined;
      saasPlan?: SaasPlan | undefined;
    },
  ) {
    const updateValues: Partial<typeof CompanyTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (typeof patch.isActive === "boolean") updateValues.isActive = patch.isActive;
    if (patch.saasStatus) updateValues.saasStatus = patch.saasStatus;
    if (patch.saasPlan) updateValues.saasPlan = patch.saasPlan;

    const [updated] = await db
      .update(CompanyTable)
      .set(updateValues)
      .where(eq(CompanyTable.id, companyId))
      .returning({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        isActive: CompanyTable.isActive,
        saasPlan: CompanyTable.saasPlan,
        saasStatus: CompanyTable.saasStatus,
      });

    return updated ?? null;
  }
}
