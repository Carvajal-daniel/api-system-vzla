import type { FastifyInstance } from "fastify";
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
}