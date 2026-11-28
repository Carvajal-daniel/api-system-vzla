import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticate,
  authorizeSuperAdmin,
} from "../../../../shared/http/auth/authenticate.js";
import { SuperAdminRepository } from "../database/super-admin.repository.js";

const saasPlanEnum = z.enum(["ESSENTIAL", "PRO", "SCALE"]);
const saasStatusEnum = z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"]);

const listTenantsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  saasPlan: saasPlanEnum.optional(),
  saasStatus: saasStatusEnum.optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

const tenantIdParamSchema = z.object({
  companyId: z.uuid(),
});

const updateTenantStatusBodySchema = z
  .object({
    isActive: z.boolean().optional(),
    saasStatus: saasStatusEnum.optional(),
    saasPlan: saasPlanEnum.optional(),
  })
  .refine(
    (body) =>
      body.isActive !== undefined ||
      body.saasStatus !== undefined ||
      body.saasPlan !== undefined,
    "Informe ao menos um campo para atualização.",
  );

export async function adminRoutes(
  app: FastifyInstance,
  options?: { repository?: SuperAdminRepository },
): Promise<void> {
  const repository = options?.repository ?? new SuperAdminRepository();
  const superAdminGuard = [authenticate, authorizeSuperAdmin];

  app.get(
    "/admin/overview",
    {
      preHandler: superAdminGuard,
      schema: {
        tags: ["Super-Admin"],
        summary: "Métricas globais da plataforma SaaS multi-tenant",
        security: [{ bearerAuth: [] }],
        response: {
          200: { type: "object", additionalProperties: true },
          401: { type: "object", properties: { message: { type: "string" } } },
          403: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async () => repository.getOverview(),
  );

  app.get(
    "/admin/tenants",
    {
      preHandler: superAdminGuard,
      schema: {
        tags: ["Super-Admin"],
        summary: "Listagem multi-tenant de todas as barbearias e salões cadastrados",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            search: { type: "string" },
            saasPlan: { type: "string", enum: ["ESSENTIAL", "PRO", "SCALE"] },
            saasStatus: {
              type: "string",
              enum: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"],
            },
            isActive: { type: "string", enum: ["true", "false"] },
          },
        },
        response: {
          200: { type: "array", items: { type: "object", additionalProperties: true } },
          401: { type: "object", properties: { message: { type: "string" } } },
          403: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request) => {
      const filters = listTenantsQuerySchema.parse(request.query ?? {});
      return repository.listTenants(filters);
    },
  );

  app.get(
    "/admin/tenants/:companyId",
    {
      preHandler: superAdminGuard,
      schema: {
        tags: ["Super-Admin"],
        summary: "Detalhes operacionais e financeiros de um tenant específico",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string", format: "uuid" } },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          404: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { companyId } = tenantIdParamSchema.parse(request.params);
      const details = await repository.getTenantDetails(companyId);
      if (!details) {
        return reply.status(404).send({ message: "Estabelecimento não encontrado." });
      }
      return reply.status(200).send(details);
    },
  );

  app.patch(
    "/admin/tenants/:companyId/status",
    {
      preHandler: superAdminGuard,
      schema: {
        tags: ["Super-Admin"],
        summary: "Ativar/suspender um tenant ou ajustar seu plano/status SaaS",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            isActive: { type: "boolean" },
            saasStatus: {
              type: "string",
              enum: ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"],
            },
            saasPlan: { type: "string", enum: ["ESSENTIAL", "PRO", "SCALE"] },
          },
        },
        response: {
          200: { type: "object", additionalProperties: true },
          400: { type: "object", properties: { message: { type: "string" } } },
          404: { type: "object", properties: { message: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const { companyId } = tenantIdParamSchema.parse(request.params);
      const body = updateTenantStatusBodySchema.parse(request.body);
      // Impede que o próprio super-admin suspenda acidentalmente sua própria conta ativa.
      if (companyId === request.actor!.companyId && body.isActive === false) {
        return reply.status(400).send({
          message: "Você não pode suspender a própria conta de administrador.",
        });
      }
      const updated = await repository.updateTenantStatus(companyId, body);
      if (!updated) {
        return reply.status(404).send({ message: "Estabelecimento não encontrado." });
      }
      return reply.status(200).send(updated);
    },
  );
}
