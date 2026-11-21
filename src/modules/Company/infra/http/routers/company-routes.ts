import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../database/schema/companies-schema.js";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import { updateCompanyTimezoneSchema } from "../../../../../shared/utils/validation-schemas.js";
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
  app.get(
    "/companies/me/monthly-goal",
    { preHandler: [authenticate, authorizeRoles("OWNER")] },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") return reply.status(403).send({ message: "You do not have permission to perform this action." });
      const [company] = await db.select({ monthlyGoalInCents: CompanyTable.monthlyGoalInCents, currency: CompanyTable.monthlyGoalCurrency }).from(CompanyTable).where(eq(CompanyTable.id, actor.companyId)).limit(1);
      if (!company) return reply.status(404).send({ message: "Company not found." });
      return reply.status(200).send(company);
    },
  );

  app.patch(
    "/companies/me/monthly-goal",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: { body: { type: "object", required: ["monthlyGoalInCents", "currency"], properties: { monthlyGoalInCents: { type: "integer", minimum: 0 }, currency: { type: "string", enum: ["BRL", "USD"] } } } },
    },
    async (request, reply) => {
      const actor = request.actor;
      if (!actor || actor.role !== "OWNER") return reply.status(403).send({ message: "You do not have permission to perform this action." });
      const body = z.object({ monthlyGoalInCents: z.number().int().min(0).max(2147483647), currency: z.enum(["BRL", "USD"]) }).parse(request.body);
      const [company] = await db.update(CompanyTable).set({ monthlyGoalInCents: body.monthlyGoalInCents, monthlyGoalCurrency: body.currency, updatedAt: new Date() }).where(eq(CompanyTable.id, actor.companyId)).returning({ monthlyGoalInCents: CompanyTable.monthlyGoalInCents, currency: CompanyTable.monthlyGoalCurrency });
      if (!company) return reply.status(404).send({ message: "Company not found." });
      return reply.status(200).send(company);
    },
  );
}
