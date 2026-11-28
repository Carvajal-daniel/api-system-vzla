import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { SubscriptionPlanTable } from "../../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import {
  ClientSubscriptionTable,
  PaymentChargeTable,
} from "../../../../payments/infra/database/schema/payments-schema.js";

const DAY_MS = 86_400_000;

export interface ExecutiveDashboardOutput {
  period: {
    from: string;
    to: string;
    timezone: string;
  };
  currency: "BRL" | "USD" | "VES";
  revenueSplit: {
    avulsaRevenueInCents: number;
    clubMrrInCents: number;
    clubCollectedInCents: number;
    totalRevenueInCents: number;
    activeSubscribersCount: number;
    clubSharePercent: number;
  };
  depositConversion: {
    totalCharges: number;
    confirmedCharges: number;
    pendingCharges: number;
    expiredOrCanceledCharges: number;
    conversionRatePercent: number;
    totalDepositedInCents: number;
  };
  attendanceComparison: {
    subscribers: {
      completed: number;
      noShow: number;
      ratePercent: number | null;
    };
    avulsos: {
      completed: number;
      noShow: number;
      ratePercent: number | null;
    };
  };
  upcomingRenewals7Days: {
    totalCount: number;
    totalExpectedCents: number;
    items: Array<{
      subscriptionId: string;
      clientName: string;
      clientPhone: string;
      planName: string;
      priceCents: number;
      currentPeriodEnd: string;
      status: string;
      daysRemaining: number;
    }>;
  };
  rankings: {
    services: Array<{
      serviceId: string;
      serviceName: string;
      completedCount: number;
      totalCount: number;
      revenueInCents: number;
    }>;
    professionals: Array<{
      collaboratorId: string;
      name: string;
      avatarUrl: string | null;
      completedCount: number;
      revenueInCents: number;
    }>;
  };
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

// Consolida os KPIs executivos reais da barbearia (receita avulsa vs. MRR Clube VIP,
// conversão de sinais anti-no-show, comparecimento VIP vs. avulso, renovações em 7 dias e rankings).
export async function readExecutiveDashboard(params: {
  companyId: string;
  from?: string | undefined;
  to?: string | undefined;
  now?: Date | undefined;
}): Promise<ExecutiveDashboardOutput> {
  const now = params.now ?? new Date();
  const [company] = await db
    .select({
      timezone: CompanyTable.timezone,
      currency: CompanyTable.currency,
    })
    .from(CompanyTable)
    .where(eq(CompanyTable.id, params.companyId))
    .limit(1);

  const timezone = company?.timezone ?? "America/Sao_Paulo";
  const currency = company?.currency ?? "BRL";
  const dayFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = dayFormatter.format(now);
  const monthStart = new Date(`${todayStr.slice(0, 7)}-01T00:00:00Z`);
  const monthEnd = new Date(monthStart);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);

  const fromDate = params.from ?? monthStart.toISOString().slice(0, 10);
  const toDate = params.to ?? monthEnd.toISOString().slice(0, 10);
  const fromUtc = new Date(`${fromDate}T00:00:00Z`);
  const toUtc = new Date(`${toDate}T23:59:59.999Z`);
  const next7DaysUtc = new Date(now.getTime() + 7 * DAY_MS);

  const localDay = sql`timezone(${timezone}, ${AppointmentTable.startsAt})::date`;

  const [appointments, collaborators, subscriptions, depositCharges, clubCharges] =
    await Promise.all([
      db
        .select({
          id: AppointmentTable.id,
          collaboratorId: AppointmentTable.collaboratorId,
          serviceId: AppointmentTable.serviceId,
          serviceName: AppointmentTable.serviceNameSnapshot,
          priceInCents: AppointmentTable.servicePriceInCentsSnapshot,
          status: AppointmentTable.status,
          usesClubBenefit: AppointmentTable.usesClubBenefit,
          startsAt: AppointmentTable.startsAt,
        })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, params.companyId),
            gte(AppointmentTable.startsAt, new Date(fromUtc.getTime() - DAY_MS)),
            lt(AppointmentTable.startsAt, new Date(toUtc.getTime() + DAY_MS)),
            gte(localDay, sql`${fromDate}::date`),
            lte(localDay, sql`${toDate}::date`),
          ),
        ),
      db
        .select({
          id: CollaboratorTable.id,
          name: CollaboratorTable.name,
          avatarUrl: CollaboratorTable.avatarUrl,
        })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.companyId, params.companyId))
        .orderBy(asc(CollaboratorTable.name)),
      db
        .select({
          id: ClientSubscriptionTable.id,
          status: ClientSubscriptionTable.status,
          priceCents: ClientSubscriptionTable.priceCents,
          currentPeriodEnd: ClientSubscriptionTable.currentPeriodEnd,
          clientName: ClientTable.name,
          clientPhone: ClientTable.phone,
          planName: SubscriptionPlanTable.name,
        })
        .from(ClientSubscriptionTable)
        .innerJoin(
          ClientTable,
          and(
            eq(ClientTable.companyId, params.companyId),
            eq(ClientTable.id, ClientSubscriptionTable.clientId),
          ),
        )
        .innerJoin(
          SubscriptionPlanTable,
          and(
            eq(SubscriptionPlanTable.companyId, params.companyId),
            eq(SubscriptionPlanTable.id, ClientSubscriptionTable.planId),
          ),
        )
        .where(
          and(
            eq(ClientSubscriptionTable.companyId, params.companyId),
            inArray(ClientSubscriptionTable.status, ["ACTIVE", "PAST_DUE"]),
          ),
        ),
      db
        .select({
          status: PaymentChargeTable.status,
          amountCents: PaymentChargeTable.amountCents,
          expiresAt: PaymentChargeTable.expiresAt,
          paidAt: PaymentChargeTable.paidAt,
        })
        .from(PaymentChargeTable)
        .where(
          and(
            eq(PaymentChargeTable.companyId, params.companyId),
            eq(PaymentChargeTable.referenceType, "APPOINTMENT_DEPOSIT"),
          ),
        ),
      db
        .select({
          amountCents: PaymentChargeTable.amountCents,
          paidAt: PaymentChargeTable.paidAt,
        })
        .from(PaymentChargeTable)
        .where(
          and(
            eq(PaymentChargeTable.companyId, params.companyId),
            eq(PaymentChargeTable.referenceType, "SUBSCRIPTION"),
            eq(PaymentChargeTable.status, "CONFIRMED"),
            gte(PaymentChargeTable.paidAt, fromUtc),
            lte(PaymentChargeTable.paidAt, toUtc),
          ),
        ),
    ]);

  // 1. Receita Avulsa vs. MRR Clube VIP + Comparecimento + Rankings
  let avulsaRevenueInCents = 0;
  let subCompleted = 0;
  let subNoShow = 0;
  let avulsoCompleted = 0;
  let avulsoNoShow = 0;

  const serviceMap = new Map<
    string,
    { serviceId: string; serviceName: string; completedCount: number; totalCount: number; revenueInCents: number }
  >();
  const proMap = new Map<
    string,
    { collaboratorId: string; name: string; avatarUrl: string | null; completedCount: number; revenueInCents: number }
  >();
  for (const col of collaborators) {
    proMap.set(col.id, {
      collaboratorId: col.id,
      name: col.name,
      avatarUrl: col.avatarUrl ?? null,
      completedCount: 0,
      revenueInCents: 0,
    });
  }

  for (const appt of appointments) {
    const isCompleted = appt.status === "COMPLETED" && appt.startsAt <= now;
    const isNoShow = appt.status === "NO_SHOW";

    if (appt.usesClubBenefit) {
      if (isCompleted) subCompleted += 1;
      else if (isNoShow) subNoShow += 1;
    } else {
      if (isCompleted) {
        avulsoCompleted += 1;
        avulsaRevenueInCents += appt.priceInCents;
      } else if (isNoShow) {
        avulsoNoShow += 1;
      }
    }

    if (appt.status !== "CANCELED") {
      const svc = serviceMap.get(appt.serviceId) ?? {
        serviceId: appt.serviceId,
        serviceName: appt.serviceName,
        completedCount: 0,
        totalCount: 0,
        revenueInCents: 0,
      };
      svc.totalCount += 1;
      if (isCompleted) {
        svc.completedCount += 1;
        svc.revenueInCents += appt.priceInCents;
      }
      serviceMap.set(appt.serviceId, svc);

      const pro = proMap.get(appt.collaboratorId);
      if (pro && isCompleted) {
        pro.completedCount += 1;
        pro.revenueInCents += appt.priceInCents;
      }
    }
  }

  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const clubMrrInCents = activeSubs.reduce((sum, s) => sum + s.priceCents, 0);
  const clubCollectedInCents = clubCharges.reduce((sum, c) => sum + c.amountCents, 0);
  const totalRevenueInCents = avulsaRevenueInCents + clubMrrInCents;

  // 2. Conversão de Sinais Anti-No-Show
  let confirmedCharges = 0;
  let pendingCharges = 0;
  let expiredOrCanceledCharges = 0;
  let totalDepositedInCents = 0;

  for (const charge of depositCharges) {
    const referenceDate = charge.paidAt ?? charge.expiresAt;
    if (referenceDate && (referenceDate < fromUtc || referenceDate > toUtc)) {
      continue;
    }
    if (charge.status === "CONFIRMED") {
      confirmedCharges += 1;
      totalDepositedInCents += charge.amountCents;
    } else if (
      charge.status === "EXPIRED" ||
      charge.status === "CANCELED" ||
      (charge.status === "PENDING" && charge.expiresAt && charge.expiresAt <= now)
    ) {
      expiredOrCanceledCharges += 1;
    } else {
      pendingCharges += 1;
    }
  }
  const totalCharges = confirmedCharges + pendingCharges + expiredOrCanceledCharges;

  // 3. Previsão de Renovações nos Próximos 7 Dias
  const renewalItems = subscriptions
    .filter(
      (s) =>
        s.currentPeriodEnd !== null &&
        s.currentPeriodEnd <= next7DaysUtc,
    )
    .map((s) => {
      const daysRemaining = Math.ceil(
        (s.currentPeriodEnd!.getTime() - now.getTime()) / DAY_MS,
      );
      return {
        subscriptionId: s.id,
        clientName: s.clientName,
        clientPhone: s.clientPhone,
        planName: s.planName,
        priceCents: s.priceCents,
        currentPeriodEnd: s.currentPeriodEnd!.toISOString(),
        status: s.status,
        daysRemaining,
      };
    })
    .sort((a, b) => a.currentPeriodEnd.localeCompare(b.currentPeriodEnd));

  const subAttDenom = subCompleted + subNoShow;
  const avulsoAttDenom = avulsoCompleted + avulsoNoShow;

  return {
    period: { from: fromDate, to: toDate, timezone },
    currency,
    revenueSplit: {
      avulsaRevenueInCents,
      clubMrrInCents,
      clubCollectedInCents,
      totalRevenueInCents,
      activeSubscribersCount: activeSubs.length,
      clubSharePercent: roundPercent(clubMrrInCents, totalRevenueInCents),
    },
    depositConversion: {
      totalCharges,
      confirmedCharges,
      pendingCharges,
      expiredOrCanceledCharges,
      conversionRatePercent: roundPercent(confirmedCharges, totalCharges),
      totalDepositedInCents,
    },
    attendanceComparison: {
      subscribers: {
        completed: subCompleted,
        noShow: subNoShow,
        ratePercent: subAttDenom > 0 ? roundPercent(subCompleted, subAttDenom) : null,
      },
      avulsos: {
        completed: avulsoCompleted,
        noShow: avulsoNoShow,
        ratePercent: avulsoAttDenom > 0 ? roundPercent(avulsoCompleted, avulsoAttDenom) : null,
      },
    },
    upcomingRenewals7Days: {
      totalCount: renewalItems.length,
      totalExpectedCents: renewalItems.reduce((sum, item) => sum + item.priceCents, 0),
      items: renewalItems,
    },
    rankings: {
      services: [...serviceMap.values()]
        .sort((a, b) => b.revenueInCents - a.revenueInCents || b.completedCount - a.completedCount)
        .slice(0, 8),
      professionals: [...proMap.values()]
        .filter((p) => p.completedCount > 0 || p.revenueInCents > 0)
        .sort((a, b) => b.revenueInCents - a.revenueInCents || b.completedCount - a.completedCount)
        .slice(0, 8),
    },
  };
}
