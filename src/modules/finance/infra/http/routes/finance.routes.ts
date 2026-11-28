import { getCommissionStatus } from "../../../domain/collections.js";
import { listCommissionDeductions } from "../../database/repositories/commission-deductions.js";
import { readOutflowSummary } from "../../database/repositories/outflow-projections.js";
import { productCashTotals } from "../../../../inventory/infra/database/inventory-projections.js";
import { readCollectionTotals } from "../../database/repositories/collection-totals.js";
import { readExecutiveDashboard } from "../../database/repositories/executive-dashboard.repository.js";
import { and, asc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../../../../shared/database/database.js";
import {
  authenticate,
  authorizeRoles,
} from "../../../../../shared/http/auth/authenticate.js";
import { InvalidLocalDateError } from "../../../../appointments/domain/errors/appointment-errors.js";
import type { AppointmentStatusValue } from "../../../../appointments/domain/value-objects/appointment-status.vo.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

const financeQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  collaboratorId: z.uuid().optional(),
});

const DAY_MS = 86_400_000;
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

function getSummary() {
  return {
    realizedRevenueInCents: 0,
    forecastRevenueInCents: 0,
    realizedCommissionsInCents: 0,
    forecastCommissionsInCents: 0,
    completedCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    canceledCount: 0,
    noShowCount: 0,
  };
}

function finalizeSummary(totals: ReturnType<typeof getSummary>) {
  const totalProjectedRevenueInCents =
    totals.realizedRevenueInCents + totals.forecastRevenueInCents;
  return {
    ...totals,
    totalProjectedRevenueInCents,
    netProfitRealizedInCents: totals.realizedRevenueInCents - totals.realizedCommissionsInCents,
    netProfitProjectedInCents:
      totalProjectedRevenueInCents - totals.realizedCommissionsInCents - totals.forecastCommissionsInCents,
  };
}

const countByStatus = {
  COMPLETED: "completedCount",
  CONFIRMED: "confirmedCount",
  PENDING: "pendingCount",
  CANCELED: "canceledCount",
  NO_SHOW: "noShowCount",
} as const;

function emptyDay(date: string) {
  return {
    date,
    realizedInCents: 0,
    forecastInCents: 0,
    commissionsInCents: 0,
    appointmentsCount: 0,
  };
}

function collaboratorTotals(collaborator: {
  id: string;
  name: string;
  specialty: string;
  avatarUrl: string | null;
}) {
  return {
    collaboratorId: collaborator.id,
    name: collaborator.name,
    specialty: collaborator.specialty,
    avatarUrl: collaborator.avatarUrl,
    completedCount: 0,
    upcomingCount: 0,
    realizedRevenueInCents: 0,
    commissionToPayInCents: 0,
    forecastCommissionInCents: 0,
    commissionPercentageSum: 0,
    awaitingCommissionInCents: 0,
    readyCommissionInCents: 0,
    paidCommissionInCents: 0,
  };
}

export async function financeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/finance/summary",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: {
        tags: ["Finance (Owner)"],
        summary: "Resumo financeiro, evolução e comissões por período",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", description: "Data inicial (YYYY-MM-DD)" },
            to: { type: "string", description: "Data final (YYYY-MM-DD)" },
            collaboratorId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          403: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      if (!request.actor || request.actor.role !== "OWNER") {
        return reply.status(403).send({ message: "You do not have permission to perform this action." });
      }

      const { from, to, collaboratorId } = financeQuerySchema.parse(request.query ?? {});
      const companyId = request.actor.companyId;
      const [company] = await db.select({
        timezone: CompanyTable.timezone,
        currency: CompanyTable.currency,
        financeOpenedOn: CompanyTable.financeOpenedOn,
      })
        .from(CompanyTable).where(eq(CompanyTable.id, companyId)).limit(1);
      const timezone = company?.timezone ?? "America/Sao_Paulo";
      const dayFormatter = new Intl.DateTimeFormat("sv-SE", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      });
      const now = new Date();
      const today = dayFormatter.format(now);
      const monthStart = new Date(today.slice(0, 7) + "-01T00:00:00Z");
      const monthEnd = new Date(monthStart);
      monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);

      const fromDate = from ?? dateKey(monthStart);
      const toDate = to ?? dateKey(monthEnd);
      if (fromDate > toDate) throw new InvalidLocalDateError("The start date must be on or before the end date.");

      const firstDay = Date.parse(fromDate + "T00:00:00Z");
      const lastDay = Date.parse(toDate + "T00:00:00Z");
      const comparisonStart = firstDay - (lastDay - firstDay + DAY_MS);
      if (new Date(comparisonStart).getUTCFullYear() < 1) {
        throw new InvalidLocalDateError("The range is too early to compare with a previous period.");
      }
      const previousFrom = dateKey(new Date(comparisonStart));
      const previousTo = dateKey(new Date(firstDay - DAY_MS));
      const localDay = sql`timezone(${timezone}, ${AppointmentTable.startsAt})::date`;
      // The UTC bounds cover every possible offset and retain the startsAt index.
      // The local-date bounds decide which bookings belong to the report.
      const appointmentRange = and(
        gte(AppointmentTable.startsAt, new Date(comparisonStart - DAY_MS)),
        lt(AppointmentTable.startsAt, new Date(lastDay + 2 * DAY_MS)),
        gte(localDay, sql`${previousFrom}::date`),
        lte(localDay, sql`${toDate}::date`),
      );

      const [appointments, collaborators, [serviceCashDays, captured], outflows, deductions, productCashDays] = await Promise.all([
        db.select({
          id: AppointmentTable.id,
          collaboratorId: AppointmentTable.collaboratorId,
          startsAt: AppointmentTable.startsAt,
          localDate: sql<string>`to_char(${localDay}, 'YYYY-MM-DD')`,
          completedAt: AppointmentTable.completedAt,
          status: AppointmentTable.status,
          clientName: AppointmentTable.clientName,
          serviceName: AppointmentTable.serviceNameSnapshot,
          serviceId: AppointmentTable.serviceId,
          grossInCents: AppointmentTable.servicePriceInCentsSnapshot,
          commissionPercentage: AppointmentTable.commissionPercentageSnapshot,
        }).from(AppointmentTable).where(and(
          eq(AppointmentTable.companyId, companyId),
          appointmentRange,
          collaboratorId ? eq(AppointmentTable.collaboratorId, collaboratorId) : undefined,
        )).orderBy(asc(AppointmentTable.startsAt), asc(AppointmentTable.id)),
        db.select({
          id: CollaboratorTable.id,
          name: CollaboratorTable.name,
          specialty: CollaboratorTable.specialty,
          avatarUrl: CollaboratorTable.avatarUrl,
        }).from(CollaboratorTable)
          .where(eq(CollaboratorTable.companyId, companyId))
          .orderBy(asc(CollaboratorTable.name)),
        readCollectionTotals(companyId, previousFrom, toDate, appointmentRange, collaboratorId),
        readOutflowSummary(companyId, timezone, today, { from: fromDate, to: toDate }, previousFrom, collaboratorId),
        listCommissionDeductions(db, companyId, { collaboratorId, to: today }, true),
        collaboratorId ? [] : productCashTotals(companyId, timezone, previousFrom, toDate),
      ]);
      const capturedByAppointment = new Map(captured.map((row) => [row.appointmentId, row]));
      const dailyCash = new Map<string, (typeof serviceCashDays)[number]>();
      for (const entry of [...serviceCashDays, ...productCashDays]) {
        const key = entry.date + "/" + entry.method;
        const prior = dailyCash.get(key);
        dailyCash.set(key, { ...entry, collectedInCents: (prior?.collectedInCents ?? 0) + entry.collectedInCents });
      }
      const cashDays = [...dailyCash.values()].sort((a, b) => a.date.localeCompare(b.date));
      const currentCashDays = cashDays.filter((item) => item.date >= fromDate);
      const previousCashDays = cashDays.filter((item) => item.date < fromDate);
      const paidByMethod: Partial<Record<(typeof cashDays)[number]["method"], number>> = {};
      for (const item of currentCashDays) {
        paidByMethod[item.method] = (paidByMethod[item.method] ?? 0) + item.collectedInCents;
      }
      const deductionsByCollaborator = new Map<string, number>();
      for (const deduction of deductions) {
        deductionsByCollaborator.set(deduction.collaboratorId,
          (deductionsByCollaborator.get(deduction.collaboratorId) ?? 0) + deduction.openAmountCents);
      }
      let outstandingInCents = 0;
      let awaitingCommissionInCents = 0;
      let readyCommissionInCents = 0;
      let paidCommissionInCents = 0;

      const summary = getSummary();
      const previous = getSummary();
      const daily = new Map<string, ReturnType<typeof emptyDay>>();
      const staff = new Map(collaborators
        .filter((person) => !collaboratorId || person.id === collaboratorId)
        .map((person) => [person.id, collaboratorTotals(person)]));
      const services = new Map<string, { serviceId: string; serviceName: string; count: number; revenueInCents: number; realizedInCents: number; realizedCount: number }>();
      const details = [];

      for (const appointment of appointments) {
        const { startsAt, localDate: date, grossInCents, commissionPercentage } = appointment;
        const rawStatus = appointment.status as AppointmentStatusValue;
        // Regra de negócio: atendimentos futuros nunca contam como concluídos nem geram faturamento/comissão realizados.
        const isFuture = startsAt > now;
        const status: AppointmentStatusValue = rawStatus === "COMPLETED" && isFuture ? "CONFIRMED" : rawStatus;
        const realized = status === "COMPLETED";
        const forecast = status === "CONFIRMED" || status === "PENDING";
        const booked = realized || forecast;
        const commissionInCents = booked ? Math.round(grossInCents * commissionPercentage / 100) : 0;
        const current = date >= fromDate;
        const totals = current ? summary : previous;

        totals[countByStatus[status]] += 1;
        if (realized) {
          totals.realizedRevenueInCents += grossInCents;
          totals.realizedCommissionsInCents += commissionInCents;
        } else if (forecast) {
          totals.forecastRevenueInCents += grossInCents;
          totals.forecastCommissionsInCents += commissionInCents;
        }
        if (!current) continue;

        const person = staff.get(appointment.collaboratorId);
        const capturedPayment = capturedByAppointment.get(appointment.id);
        const collectedInCents = capturedPayment?.collectedInCents ?? 0;
        const historyDate = dayFormatter.format(appointment.completedAt ?? startsAt);
        const historical = realized && historyDate < (company?.financeOpenedOn ?? today) &&
          !capturedPayment?.movements;
        const collectible = realized || status === "CONFIRMED";
        const netInCents = capturedPayment?.netInCents ?? grossInCents;
        const openInCents = collectible ? Math.max(0, netInCents - collectedInCents) : 0;
        const generated = realized ? capturedPayment?.generatedCommissionInCents ?? commissionInCents : 0;
        const commissionStatus = getCommissionStatus(status, generated, capturedPayment?.commissionPaidAt ?? null, collectedInCents, netInCents);
        if (realized && !historical) outstandingInCents += openInCents;
        if (commissionStatus === "PAID") {
          paidCommissionInCents += generated;
          if (person) person.paidCommissionInCents += generated;
        }
        if (commissionStatus === "READY") {
          readyCommissionInCents += generated;
          if (person) person.readyCommissionInCents += generated;
        }
        if (commissionStatus === "AWAITING_COLLECTION") {
          awaitingCommissionInCents += generated;
          if (person) person.awaitingCommissionInCents += generated;
        }
        const { completedAt, localDate: _localDate, ...appointmentDetails } = appointment;
        details.push({
          ...appointmentDetails,
          completedAt,
          payment: {
            netInCents, collectedInCents, openInCents, historical, commissionStatus,
            canCollect: collectible && openInCents > 0,
          },
          status,
          collaboratorName: person?.name ?? null,
          commissionInCents,
          netInCents: booked ? grossInCents - commissionInCents : 0,
        });

        const day = daily.get(date) ?? emptyDay(date);
        daily.set(date, day);
        if (!booked) continue;

        day.appointmentsCount += 1;
        day.commissionsInCents += commissionInCents;
        if (realized) day.realizedInCents += grossInCents;
        else day.forecastInCents += grossInCents;

        if (person) {
          person.commissionPercentageSum += commissionPercentage;
          if (realized) {
            person.completedCount += 1;
            person.realizedRevenueInCents += grossInCents;
            if (commissionStatus === "READY" || commissionStatus === "AWAITING_COLLECTION") {
              person.commissionToPayInCents += generated;
            }
          } else {
            person.upcomingCount += 1;
            person.forecastCommissionInCents += commissionInCents;
          }
        }

        const { serviceId, serviceName } = appointment;
        const service = services.get(serviceId) ??
          { serviceId, serviceName, count: 0, revenueInCents: 0, realizedInCents: 0, realizedCount: 0 };
        service.count += 1;
        service.revenueInCents += grossInCents;
        if (realized) {
          service.realizedInCents += grossInCents;
          service.realizedCount += 1;
        }
        services.set(serviceId, service);
      }

      const byCollaborator = [...staff.values()].map(({ commissionPercentageSum, ...person }) => {
        const count = person.completedCount + person.upcomingCount;
        const deductionsInCents = deductionsByCollaborator.get(person.collaboratorId) ?? 0;
        return { ...person, deductionsInCents, netPayableInCents: Math.max(0, person.readyCommissionInCents - deductionsInCents),
          averageCommissionPercentage: count ? commissionPercentageSum / count : null };
      }).sort((a, b) => b.commissionToPayInCents + b.forecastCommissionInCents -
        a.commissionToPayInCents - a.forecastCommissionInCents);

      const currentSummary = finalizeSummary(summary);
      const previousSummary = finalizeSummary(previous);
      const currentCollectedInCents = currentCashDays.reduce((sum, day) => sum + day.collectedInCents, 0);
      const previousCollectedInCents = previousCashDays.reduce((sum, day) => sum + day.collectedInCents, 0);
      return reply.send({
        period: { from: fromDate, to: toDate, timezone, collaboratorId: collaboratorId ?? null },
        summary: {
          ...currentSummary,
          realNetProfitInCents: outflows.expenses
            ? currentCollectedInCents - outflows.cashCommissionsCents - outflows.expenses.cashPaidCents : null,
        },
        expenses: outflows.expenses,
        outflowCashDays: outflows.cashDays,
        insights: {
          ...outflows.alerts,
          payableCommissionInCents: readyCommissionInCents,
          unsettledCommissionInCents: readyCommissionInCents + awaitingCommissionInCents,
          netPayableCommissionInCents: byCollaborator.reduce((sum, person) => sum + person.netPayableInCents, 0),
          expensesAsRevenuePercent: outflows.expenses && currentSummary.realizedRevenueInCents > 0
            ? outflows.expenses.totalCents / currentSummary.realizedRevenueInCents * 100 : null,
        },
        currency: company?.currency ?? "BRL",
        collections: {
          openedOn: company?.financeOpenedOn ?? today,
          collectedInCents: currentCollectedInCents,
          previousCollectedInCents,
          productSalesInCents: productCashDays.reduce((sum, row) => sum + (row.date >= fromDate ? row.collectedInCents : 0), 0),
          cashCommissionsInCents: outflows.cashCommissionsCents,
          outstandingInCents, paidByMethod, awaitingCommissionInCents, readyCommissionInCents, paidCommissionInCents,
          generatedCommissionInCents: awaitingCommissionInCents + readyCommissionInCents + paidCommissionInCents,
          currentCashDays, previousCashDays,
        },
        comparison: { from: previousFrom, to: previousTo, summary: {
          ...previousSummary,
          realNetProfitInCents: outflows.expenses
            ? previousCollectedInCents - outflows.previousCashCommissionsCents - outflows.expenses.previousCashPaidCents : null,
        } },
        series: [...daily.values()],
        professionals: collaborators.map(({ id, name }) => ({ id, name })),
        byCollaborator,
        byService: [...services.values()].sort((a, b) => b.realizedInCents - a.realizedInCents),
        appointments: details,
      });
    },
  );

  app.get(
    "/finance/executive-dashboard",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: {
        tags: ["Finance (Owner)"],
        summary: "KPIs executivos da barbearia: receita avulsa vs. MRR Clube VIP, conversão de sinais, comparecimento, renovações em 7 dias e rankings",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", description: "Data inicial (YYYY-MM-DD)" },
            to: { type: "string", description: "Data final (YYYY-MM-DD)" },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          401: { type: "object", properties: { message: { type: "string" } } },
          403: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { from, to } = financeQuerySchema.parse(request.query ?? {});
      if (from && to && from > to) {
        throw new InvalidLocalDateError("A data inicial deve ser anterior ou igual à data final.");
      }
      const data = await readExecutiveDashboard({
        companyId: request.actor!.companyId,
        from,
        to,
      });
      return reply.status(200).send(data);
    },
  );
}
