import { and, eq, gte, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../../../../shared/database/database.js";
import {
  authenticate,
  authorizeRoles,
} from "../../../../../shared/http/auth/authenticate.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

const financeQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format")
    .optional(),
});

function formatDateKeyInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getDefaultMonthRange(timeZone: string): { from: string; to: string } {
  const today = formatDateKeyInTimezone(new Date(), timeZone);
  const [y = 2026, m = 1] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
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
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
          403: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.actor || request.actor.role !== "OWNER") {
        return reply.status(403).send({
          message: "You do not have permission to perform this action.",
        });
      }

      const parsed = financeQuerySchema.parse(request.query ?? {});
      const companyId = request.actor.companyId;

      const [companyRow] = await db
        .select({ timezone: CompanyTable.timezone })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, companyId))
        .limit(1);

      const timezone = companyRow?.timezone ?? "America/Sao_Paulo";
      const defaults = getDefaultMonthRange(timezone);
      const fromDate = parsed.from ?? defaults.from;
      const toDate = parsed.to ?? defaults.to;

      const fromInstant = new Date(`${fromDate}T00:00:00.000Z`);
      const toInstant = new Date(`${toDate}T23:59:59.999Z`);

      // Busca agendamentos do período e colaboradores da empresa em paralelo
      const [appointments, collaborators] = await Promise.all([
        db
          .select({
            id: AppointmentTable.id,
            collaboratorId: AppointmentTable.collaboratorId,
            startsAt: AppointmentTable.startsAt,
            status: AppointmentTable.status,
            serviceNameSnapshot: AppointmentTable.serviceNameSnapshot,
            servicePriceInCentsSnapshot:
              AppointmentTable.servicePriceInCentsSnapshot,
            commissionPercentageSnapshot:
              AppointmentTable.commissionPercentageSnapshot,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, companyId),
              gte(AppointmentTable.startsAt, fromInstant),
              lte(AppointmentTable.startsAt, toInstant),
            ),
          ),
        db
          .select({
            id: CollaboratorTable.id,
            name: CollaboratorTable.name,
            specialty: CollaboratorTable.specialty,
            avatarUrl: CollaboratorTable.avatarUrl,
            commissionPercentage: CollaboratorTable.commissionPercentage,
          })
          .from(CollaboratorTable)
          .where(eq(CollaboratorTable.companyId, companyId)),
      ]);

      let realizedRevenueInCents = 0;
      let forecastRevenueInCents = 0;
      let realizedCommissionsInCents = 0;
      let forecastCommissionsInCents = 0;
      let completedCount = 0;
      let confirmedCount = 0;
      let pendingCount = 0;
      let canceledCount = 0;
      let noShowCount = 0;

      const dailyMap = new Map<
        string,
        {
          date: string;
          realizedInCents: number;
          forecastInCents: number;
          appointmentsCount: number;
        }
      >();

      const collabAcc = new Map<
        string,
        {
          collaboratorId: string;
          name: string;
          specialty: string;
          avatarUrl: string | null;
          completedCount: number;
          upcomingCount: number;
          realizedRevenueInCents: number;
          commissionToPayInCents: number;
          forecastCommissionInCents: number;
        }
      >();

      for (const c of collaborators) {
        collabAcc.set(c.id, {
          collaboratorId: c.id,
          name: c.name,
          specialty: c.specialty,
          avatarUrl: c.avatarUrl ?? null,
          completedCount: 0,
          upcomingCount: 0,
          realizedRevenueInCents: 0,
          commissionToPayInCents: 0,
          forecastCommissionInCents: 0,
        });
      }

      const serviceAcc = new Map<
        string,
        {
          serviceName: string;
          count: number;
          revenueInCents: number;
        }
      >();

      for (const appt of appointments) {
        const price = appt.servicePriceInCentsSnapshot;
        const pct = Number(appt.commissionPercentageSnapshot);
        // Usa snapshot imutável da comissão capturado na reserva para garantir precisão contábil
        const commission = Math.round((price * pct) / 100);
        const dayKey = formatDateKeyInTimezone(appt.startsAt, timezone);

        const dayEntry = dailyMap.get(dayKey) ?? {
          date: dayKey,
          realizedInCents: 0,
          forecastInCents: 0,
          appointmentsCount: 0,
        };

        if (appt.status === "COMPLETED") {
          completedCount += 1;
          realizedRevenueInCents += price;
          realizedCommissionsInCents += commission;
          dayEntry.realizedInCents += price;
          dayEntry.appointmentsCount += 1;

          const cRow = collabAcc.get(appt.collaboratorId);
          if (cRow) {
            cRow.completedCount += 1;
            cRow.realizedRevenueInCents += price;
            cRow.commissionToPayInCents += commission;
          }

          const sRow = serviceAcc.get(appt.serviceNameSnapshot) ?? {
            serviceName: appt.serviceNameSnapshot,
            count: 0,
            revenueInCents: 0,
          };
          sRow.count += 1;
          sRow.revenueInCents += price;
          serviceAcc.set(appt.serviceNameSnapshot, sRow);
        } else if (appt.status === "CONFIRMED" || appt.status === "PENDING") {
          if (appt.status === "CONFIRMED") confirmedCount += 1;
          else pendingCount += 1;

          forecastRevenueInCents += price;
          forecastCommissionsInCents += commission;
          dayEntry.forecastInCents += price;
          dayEntry.appointmentsCount += 1;

          const cRow = collabAcc.get(appt.collaboratorId);
          if (cRow) {
            cRow.upcomingCount += 1;
            cRow.forecastCommissionInCents += commission;
          }

          const sRow = serviceAcc.get(appt.serviceNameSnapshot) ?? {
            serviceName: appt.serviceNameSnapshot,
            count: 0,
            revenueInCents: 0,
          };
          sRow.count += 1;
          sRow.revenueInCents += price;
          serviceAcc.set(appt.serviceNameSnapshot, sRow);
        } else if (appt.status === "CANCELED") {
          canceledCount += 1;
        } else if (appt.status === "NO_SHOW") {
          noShowCount += 1;
        }

        dailyMap.set(dayKey, dayEntry);
      }

      const series = Array.from(dailyMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date),
      );
      const byCollaborator = Array.from(collabAcc.values()).sort(
        (a, b) =>
          b.commissionToPayInCents +
          b.forecastCommissionInCents -
          (a.commissionToPayInCents + a.forecastCommissionInCents),
      );
      const byService = Array.from(serviceAcc.values()).sort(
        (a, b) => b.revenueInCents - a.revenueInCents,
      );

      const totalProjectedRevenueInCents =
        realizedRevenueInCents + forecastRevenueInCents;
      const netProfitRealizedInCents =
        realizedRevenueInCents - realizedCommissionsInCents;
      const netProfitProjectedInCents =
        totalProjectedRevenueInCents -
        (realizedCommissionsInCents + forecastCommissionsInCents);

      return reply.status(200).send({
        period: { from: fromDate, to: toDate, timezone },
        summary: {
          realizedRevenueInCents,
          forecastRevenueInCents,
          totalProjectedRevenueInCents,
          realizedCommissionsInCents,
          forecastCommissionsInCents,
          netProfitRealizedInCents,
          netProfitProjectedInCents,
          completedCount,
          confirmedCount,
          pendingCount,
          canceledCount,
          noShowCount,
        },
        series,
        byCollaborator,
        byService,
      });
    },
  );
}
