import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../shared/database/database.js";
import { CollectionsError } from "../../../../finance/domain/collections.js";
import { CompanyTable } from "../../database/schema/companies-schema.js";
import { resolveCompanyRankingWeights } from "../../../domain/ranking-weights.js";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import { updateCompanyTimezoneSchema } from "../../../../../shared/utils/validation-schemas.js";
import { updateCompanyCurrency } from "../../database/repositories/update-company-currency.js";
import { CompanyRepositoryDB } from "../../database/repositories/companies-repository.impl.js";
import { MakeCreateController } from "../factories/make-create-user-controller.js";

const createCompanyController = MakeCreateController();
const companiesRepository = new CompanyRepositoryDB();

export async function ComapnyRoutes(app: FastifyInstance) {
  app.post("/companies", createCompanyController.handle.bind(createCompanyController));

  app.patch(
    "/companies/me/timezone",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: {
        tags: ["Companies (Owner)"],
        summary: "Update the authenticated company's IANA timezone (e.g. America/Sao_Paulo, America/Caracas)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["timezone"],
          properties: {
            timezone: {
              type: "string",
              maxLength: 64,
              description: "Valid IANA timezone identifier",
            },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["companyId", "timezone"],
            properties: {
              companyId: { type: "string", format: "uuid" },
              timezone: { type: "string" },
            },
          },
          400: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
          401: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
          403: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
          404: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") {
        return reply.status(403).send({ message: "You do not have permission to perform this action." });
      }

      const { timezone } = updateCompanyTimezoneSchema.parse(request.body);
      const updated = await companiesRepository.updateTimezone(actor.companyId, timezone);

      if (!updated) {
        return reply.status(404).send({ message: "Company not found." });
      }

      return reply.status(200).send({
        companyId: actor.companyId,
        timezone,
      });
    },
  );
  app.patch("/companies/me/currency", { preHandler: [authenticate, authorizeRoles("OWNER")] }, async (request, reply) => {
    const actor = request.actor;
    if (!actor || actor.role !== "OWNER") {
      throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
    }
    const { currency } = z.object({ currency: z.enum(["BRL", "USD", "VES"]) }).parse(request.body);
    const updated = await db.transaction((tx) => updateCompanyCurrency(tx, actor.companyId, currency));
    return reply.send(updated);
  });

  app.get(
    "/companies/me/monthly-goal",
    { preHandler: [authenticate, authorizeRoles("OWNER")] },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") return reply.status(403).send({ message: "You do not have permission to perform this action." });
      const [company] = await db.select({ monthlyGoalInCents: CompanyTable.monthlyGoalInCents, currency: CompanyTable.currency }).from(CompanyTable).where(eq(CompanyTable.id, actor.companyId)).limit(1);
      if (!company) return reply.status(404).send({ message: "Company not found." });
      return reply.status(200).send(company);
    },
  );

  app.patch(
    "/companies/me/monthly-goal",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: { body: { type: "object", required: ["monthlyGoalInCents", "currency"], properties: { monthlyGoalInCents: { type: "integer", minimum: 0 }, currency: { type: "string", enum: ["BRL", "USD", "VES"] } } } },
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") return reply.status(403).send({ message: "You do not have permission to perform this action." });
      const body = z.object({ monthlyGoalInCents: z.number().int().min(0).max(2147483647), currency: z.enum(["BRL", "USD", "VES"]) }).parse(request.body);
      const [company] = await db.update(CompanyTable).set({ monthlyGoalInCents: body.monthlyGoalInCents, monthlyGoalCurrency: body.currency, updatedAt: new Date() }).where(and(eq(CompanyTable.id, actor.companyId), eq(CompanyTable.currency, body.currency))).returning({ monthlyGoalInCents: CompanyTable.monthlyGoalInCents, currency: CompanyTable.currency });
      if (!company) throw new CollectionsError("CONFLICT", "FINANCE_GOAL_CURRENCY_MISMATCH");
      return reply.status(200).send(company);
    },
  );

  // Schema Zod para validar pesos configuráveis do ranking (soma exata = 100)
  const rankingWeightsBodySchema = z
    .object({
      servicesRevenueWeight: z.number().int().min(0).max(100),
      productsSalesWeight: z.number().int().min(0).max(100),
      appointmentsVolumeWeight: z.number().int().min(0).max(100),
      clientReviewsWeight: z.number().int().min(0).max(100),
      punctualityRetentionWeight: z.number().int().min(0).max(100),
    })
    .refine(
      (w) =>
        w.servicesRevenueWeight +
          w.productsSalesWeight +
          w.appointmentsVolumeWeight +
          w.clientReviewsWeight +
          w.punctualityRetentionWeight ===
        100,
      {
        message: "A soma dos 5 pesos do ranking deve ser exatamente 100.",
      },
    );

  const rankingWeightsOpenApiObject = {
    type: "object",
    required: [
      "servicesRevenueWeight",
      "productsSalesWeight",
      "appointmentsVolumeWeight",
      "clientReviewsWeight",
      "punctualityRetentionWeight",
    ],
    properties: {
      servicesRevenueWeight: { type: "integer", minimum: 0, maximum: 100 },
      productsSalesWeight: { type: "integer", minimum: 0, maximum: 100 },
      appointmentsVolumeWeight: { type: "integer", minimum: 0, maximum: 100 },
      clientReviewsWeight: { type: "integer", minimum: 0, maximum: 100 },
      punctualityRetentionWeight: { type: "integer", minimum: 0, maximum: 100 },
    },
  } as const;

  const rankingErrorSchema = {
    type: "object",
    required: ["message"],
    properties: { message: { type: "string" } },
  } as const;

  app.get(
    "/companies/ranking-weights",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: {
        tags: ["Companies (Owner)"],
        summary: "Get configurable collaborator ranking weights for the authenticated company",
        security: [{ bearerAuth: [] }],
        response: {
          200: rankingWeightsOpenApiObject,
          401: rankingErrorSchema,
          403: rankingErrorSchema,
          404: rankingErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") {
        return reply.status(403).send({ message: "You do not have permission to perform this action." });
      }

      const [company] = await db
        .select({ rankingWeights: CompanyTable.rankingWeights })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, actor.companyId))
        .limit(1);

      if (!company) {
        return reply.status(404).send({ message: "Company not found." });
      }

      return reply.status(200).send(resolveCompanyRankingWeights(company.rankingWeights));
    },
  );

  app.put(
    "/companies/ranking-weights",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: {
        tags: ["Companies (Owner)"],
        summary: "Update configurable collaborator ranking weights (must sum to 100)",
        security: [{ bearerAuth: [] }],
        body: rankingWeightsOpenApiObject,
        response: {
          200: rankingWeightsOpenApiObject,
          400: rankingErrorSchema,
          401: rankingErrorSchema,
          403: rankingErrorSchema,
          404: rankingErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") {
        return reply.status(403).send({ message: "You do not have permission to perform this action." });
      }

      const parsed = rankingWeightsBodySchema.safeParse(request.body);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? "Pesos de ranking inválidos.";
        return reply.status(400).send({ message });
      }

      const [updated] = await db
        .update(CompanyTable)
        .set({
          rankingWeights: parsed.data,
          updatedAt: new Date(),
        })
        .where(eq(CompanyTable.id, actor.companyId))
        .returning({ rankingWeights: CompanyTable.rankingWeights });

      if (!updated) {
        return reply.status(404).send({ message: "Company not found." });
      }

      return reply.status(200).send(resolveCompanyRankingWeights(updated.rankingWeights));
    },
  );
}
