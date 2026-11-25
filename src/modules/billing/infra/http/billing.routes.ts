import type { FastifyInstance } from "fastify";
import { authenticate } from "../../../../shared/http/auth/authenticate.js";
import { PlanQuotaGuardUseCase } from "../../application/use-cases/plan-quota-guard.use-case.js";
import { DrizzleTenantUsageRepository } from "../database/repositories/drizzle-tenant-usage.repository.js";

const usageMetricSchema = {
  type: "object",
  properties: {
    used: { type: "integer" },
    limit: { type: "integer" },
    percentage: { type: "number" },
  },
  required: ["used", "limit", "percentage"],
} as const;

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const usageRepository = new DrizzleTenantUsageRepository();
  const planQuotaGuardUseCase = new PlanQuotaGuardUseCase(usageRepository);

  app.get(
    "/v1/billing/usage",
    {
      preHandler: [authenticate],
      schema: {
        tags: ["Billing"],
        summary: "Get current monthly AI and WhatsApp quota usage for the authenticated tenant",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              planName: { type: "string" },
              periodMonth: { type: "string" },
              aiSessions: usageMetricSchema,
              outboundMessages: usageMetricSchema,
              isBlocked: { type: "boolean" },
            },
            required: [
              "planName",
              "periodMonth",
              "aiSessions",
              "outboundMessages",
              "isBlocked",
            ],
          },
          401: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      // O tenantId é extraído exclusivamente do token autenticado, nunca de parâmetros externos.
      const tenantId = request.actor!.companyId;
      const summary = await planQuotaGuardUseCase.getUsageSummary(tenantId);
      return reply.status(200).send(summary);
    },
  );
}
