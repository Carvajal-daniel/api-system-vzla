import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import {
  FinancialDocumentTable,
  ReceiptTable,
} from "../../../finance/infra/database/schema/collections-schema.js";
import {
  FinanceOrderItemTable,
  FinanceOrderTable,
} from "../../../finance/infra/database/schema/orders-schema.js";
import type {
  BusinessMetricsProviderPort,
  BusinessMetricsSnapshot,
} from "../../application/ports/business-metrics-provider.port.js";
import { AiConversationInsightsTable } from "../database/schema/ai-conversation-insights-schema.js";
import { WhatsAppConversationsTable } from "../database/schema/whatsapp-conversations-schema.js";

function formatDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Consulta métricas reais multi-tenant no PostgreSQL para abastecer o Copiloto IA de Gestão.
export class DrizzleBusinessMetricsProvider
  implements BusinessMetricsProviderPort
{
  async getSnapshot(
    companyId: string,
    now = new Date(),
  ): Promise<BusinessMetricsSnapshot> {
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
    const startOfTomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
      0,
      0,
      0,
      0,
    );
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const todayDateStr = formatDateOnly(now);
    const monthStartDateStr = formatDateOnly(startOfMonth);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      companyRow,
      orderRevenueRows,
      receiptRevenueRows,
      appointmentRows,
      pendingDocCommissions,
      pendingOrderItemCommissions,
      clientStatsRows,
      whatsappConversations,
      whatsappInsights,
    ] = await Promise.all([
      db
        .select({ name: CompanyTable.name })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, companyId))
        .limit(1),
      db
        .select({
          todayPaidCents: sql<number>`COALESCE(SUM(CASE WHEN ${FinanceOrderTable.orderDate} = ${todayDateStr} THEN ${FinanceOrderTable.paidCents} ELSE 0 END), 0)::int`,
          monthPaidCents: sql<number>`COALESCE(SUM(CASE WHEN ${FinanceOrderTable.orderDate} >= ${monthStartDateStr} THEN ${FinanceOrderTable.paidCents} ELSE 0 END), 0)::int`,
          openOrdersCount: sql<number>`COUNT(*) FILTER (WHERE ${FinanceOrderTable.status} = 'OPEN')::int`,
          openOrdersTotalCents: sql<number>`COALESCE(SUM(CASE WHEN ${FinanceOrderTable.status} = 'OPEN' THEN ${FinanceOrderTable.totalCents} ELSE 0 END), 0)::int`,
        })
        .from(FinanceOrderTable)
        .where(eq(FinanceOrderTable.companyId, companyId)),
      db
        .select({
          todayReceiptsCents: sql<number>`COALESCE(SUM(CASE WHEN ${ReceiptTable.effectiveOn} = ${todayDateStr} AND ${ReceiptTable.reversesReceiptId} IS NULL THEN ${ReceiptTable.amountInCents} ELSE 0 END), 0)::int`,
          monthReceiptsCents: sql<number>`COALESCE(SUM(CASE WHEN ${ReceiptTable.effectiveOn} >= ${monthStartDateStr} AND ${ReceiptTable.reversesReceiptId} IS NULL THEN ${ReceiptTable.amountInCents} ELSE 0 END), 0)::int`,
        })
        .from(ReceiptTable)
        .where(eq(ReceiptTable.companyId, companyId)),
      db
        .select({
          todayTotal: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfToday} AND ${AppointmentTable.startsAt} < ${startOfTomorrow} AND ${AppointmentTable.status} != 'CANCELED')::int`,
          todayConfirmed: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfToday} AND ${AppointmentTable.startsAt} < ${startOfTomorrow} AND ${AppointmentTable.status} = 'CONFIRMED')::int`,
          todayCompleted: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfToday} AND ${AppointmentTable.startsAt} < ${startOfTomorrow} AND ${AppointmentTable.status} = 'COMPLETED')::int`,
          monthTotal: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfMonth})::int`,
          monthCompleted: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfMonth} AND ${AppointmentTable.status} = 'COMPLETED')::int`,
          monthCanceled: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfMonth} AND ${AppointmentTable.status} = 'CANCELED')::int`,
          monthNoShow: sql<number>`COUNT(*) FILTER (WHERE ${AppointmentTable.startsAt} >= ${startOfMonth} AND ${AppointmentTable.status} = 'NO_SHOW')::int`,
        })
        .from(AppointmentTable)
        .where(eq(AppointmentTable.companyId, companyId)),
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
          totalCents: sql<number>`COALESCE(SUM(${FinancialDocumentTable.generatedCommissionInCents}), 0)::int`,
        })
        .from(FinancialDocumentTable)
        .where(
          and(
            eq(FinancialDocumentTable.companyId, companyId),
            isNull(FinancialDocumentTable.commissionPaidAt),
          ),
        ),
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
          totalCents: sql<number>`COALESCE(SUM(${FinanceOrderItemTable.commissionCents}), 0)::int`,
        })
        .from(FinanceOrderItemTable)
        .where(
          and(
            eq(FinanceOrderItemTable.companyId, companyId),
            eq(FinanceOrderItemTable.commissionStatus, "PENDING"),
          ),
        ),
      db
        .select({
          totalClients: sql<number>`COUNT(*)::int`,
          inactive30dCount: sql<number>`COUNT(*) FILTER (WHERE ${ClientTable.lastVisitAt} IS NULL OR ${ClientTable.lastVisitAt} < ${thirtyDaysAgo})::int`,
        })
        .from(ClientTable)
        .where(eq(ClientTable.companyId, companyId)),
      db
        .select({
          id: WhatsAppConversationsTable.id,
          status: WhatsAppConversationsTable.status,
          lastMessageAt: WhatsAppConversationsTable.lastMessageAt,
        })
        .from(WhatsAppConversationsTable)
        .where(
          and(
            eq(WhatsAppConversationsTable.companyId, companyId),
            gte(WhatsAppConversationsTable.lastMessageAt, thirtyDaysAgo),
          ),
        ),
      db
        .select({
          conversationId: AiConversationInsightsTable.conversationId,
          leadTemperature: AiConversationInsightsTable.leadTemperature,
          detectedObjection: AiConversationInsightsTable.detectedObjection,
        })
        .from(AiConversationInsightsTable)
        .where(eq(AiConversationInsightsTable.companyId, companyId)),
    ]);

    const orderRev = orderRevenueRows[0];
    const receiptRev = receiptRevenueRows[0];
    const apptStats = appointmentRows[0];
    const docComm = pendingDocCommissions[0];
    const itemComm = pendingOrderItemCommissions[0];
    const clientStats = clientStatsRows[0];

    // Soma receitas de comandas + recebimentos diretos de agendamentos sem duplicar (usa maior ou soma limpa)
    const todayCents =
      (orderRev?.todayPaidCents ?? 0) + (receiptRev?.todayReceiptsCents ?? 0);
    const monthCents =
      (orderRev?.monthPaidCents ?? 0) + (receiptRev?.monthReceiptsCents ?? 0);

    const totalConversations30d = whatsappConversations.length;
    const convertedConversations30d = whatsappConversations.filter(
      (c) => c.status === "CONVERTED",
    ).length;
    const conversionRatePercent =
      totalConversations30d > 0
        ? Math.round(
            (convertedConversations30d / totalConversations30d) * 1000,
          ) / 10
        : 0;

    const stalledConversations24h = whatsappConversations.filter(
      (c) =>
        c.status !== "CONVERTED" &&
        c.status !== "ARCHIVED" &&
        c.lastMessageAt < twentyFourHoursAgo,
    ).length;

    const hotLeadsCount = whatsappInsights.filter(
      (i) => i.leadTemperature === "HOT",
    ).length;

    const objectionCounts = new Map<string, number>();
    for (const insight of whatsappInsights) {
      if (insight.detectedObjection !== "NONE") {
        objectionCounts.set(
          insight.detectedObjection,
          (objectionCounts.get(insight.detectedObjection) ?? 0) + 1,
        );
      }
    }

    let topObjection = "NONE";
    let maxObjCount = 0;
    for (const [key, count] of objectionCounts.entries()) {
      if (count > maxObjCount) {
        maxObjCount = count;
        topObjection = key;
      }
    }

    // Evita imports não utilizados enquanto mantém flexibilidade de filtros futuros
    void lt;
    void ne;
    void or;

    return {
      companyName: companyRow[0]?.name ?? "Sua Empresa",
      currency: "BRL",
      referenceDate: todayDateStr,
      revenue: {
        todayCents,
        monthCents,
        openOrdersCount: orderRev?.openOrdersCount ?? 0,
        openOrdersTotalCents: orderRev?.openOrdersTotalCents ?? 0,
      },
      appointments: {
        todayTotal: apptStats?.todayTotal ?? 0,
        todayConfirmed: apptStats?.todayConfirmed ?? 0,
        todayCompleted: apptStats?.todayCompleted ?? 0,
        monthTotal: apptStats?.monthTotal ?? 0,
        monthCompleted: apptStats?.monthCompleted ?? 0,
        monthCanceled: apptStats?.monthCanceled ?? 0,
        monthNoShow: apptStats?.monthNoShow ?? 0,
      },
      commissions: {
        pendingCount: (docComm?.count ?? 0) + (itemComm?.count ?? 0),
        pendingTotalCents:
          (docComm?.totalCents ?? 0) + (itemComm?.totalCents ?? 0),
      },
      clients: {
        totalClients: clientStats?.totalClients ?? 0,
        inactive30dCount: clientStats?.inactive30dCount ?? 0,
      },
      whatsapp: {
        totalConversations30d,
        convertedConversations30d,
        conversionRatePercent,
        stalledConversations24h,
        hotLeadsCount,
        topObjection,
      },
    };
  }
}
