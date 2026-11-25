import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { z } from "zod";
import {
  authenticate,
  authorizeRoles,
} from "../../../../shared/http/auth/authenticate.js";
import { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import { DrizzleTenantUsageRepository } from "../../../billing/infra/database/repositories/drizzle-tenant-usage.repository.js";
import { WhatsAppGatewayRouter as HybridWhatsAppGatewayRouter } from "../../../whatsapp/infra/adapters/whatsapp/whatsapp-gateway.router.js";
import { DrizzleBusinessMetricsProvider } from "../../../whatsapp/infra/ai/drizzle-business-metrics.provider.js";
import { DrizzleTenantWhatsAppChannelsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-tenant-whatsapp-channels.repository.js";
import { AnalyzeModuleIntelligenceUseCase } from "../../application/use-cases/analyze-module-intelligence.use-case.js";
import {
  ProactiveInsightNotFoundError,
  ProactiveInsightQuotaExceededError,
  ProactiveIntelligenceUseCase,
} from "../../application/use-cases/proactive-intelligence.use-case.js";
import { StreamBusinessCopilotUseCase } from "../../application/use-cases/stream-business-copilot.use-case.js";
import { INTELLIGENCE_MODULES } from "../../domain/entities/proactive-insight.types.js";
import { GeminiIntelligenceAdapter } from "../ai/gemini-intelligence.adapter.js";
import { DrizzleIntelligenceDataRepository } from "../database/repositories/drizzle-intelligence-data.repository.js";
import { DrizzleProactiveInsightsRepository } from "../database/repositories/drizzle-proactive-insights.repository.js";

const insightModuleFilterEnum = z.enum([
  "WHATSAPP",
  "AGENDA",
  "FINANCE",
  "CLIENTS",
  "SERVICES",
  "INVENTORY",
  "TEAM",
]);

const insightStatusEnum = z.enum(["PENDING", "EXECUTED", "DISMISSED"]);

const listInsightsQuerySchema = z.object({
  module: insightModuleFilterEnum.optional(),
  status: insightStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const insightIdParamSchema = z.object({
  id: z.string().uuid(),
});

const moduleAnalyzeParamSchema = z.object({
  module: z.enum(INTELLIGENCE_MODULES),
});

const copilotStreamBodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
  currentModule: z.enum(INTELLIGENCE_MODULES).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000),
      }),
    )
    .max(20)
    .optional(),
});

export interface IntelligenceRoutesOptions extends FastifyPluginOptions {
  proactiveIntelligenceUseCase?: ProactiveIntelligenceUseCase;
  analyzeModuleUseCase?: AnalyzeModuleIntelligenceUseCase;
  streamCopilotUseCase?: StreamBusinessCopilotUseCase;
}

const badRequestResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    issues: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;

const ownerGuard = [authenticate, authorizeRoles("OWNER")];

export async function intelligenceRoutes(
  app: FastifyInstance,
  options: IntelligenceRoutesOptions = {},
): Promise<void> {
  const dataRepository = new DrizzleIntelligenceDataRepository();
  const insightsRepository = new DrizzleProactiveInsightsRepository();
  const aiAdapter = new GeminiIntelligenceAdapter();
  const tenantUsageRepository = new DrizzleTenantUsageRepository();
  const planQuotaGuard = new PlanQuotaGuardUseCase(tenantUsageRepository);
  const tenantChannelsRepository =
    new DrizzleTenantWhatsAppChannelsRepository();
  const hybridGateway = new HybridWhatsAppGatewayRouter(
    tenantChannelsRepository,
  );
  const businessMetricsProvider = new DrizzleBusinessMetricsProvider();

  const proactiveIntelligenceUseCase =
    options.proactiveIntelligenceUseCase ??
    new ProactiveIntelligenceUseCase(
      dataRepository,
      insightsRepository,
      aiAdapter,
      hybridGateway,
      planQuotaGuard,
    );

  const analyzeModuleUseCase =
    options.analyzeModuleUseCase ??
    new AnalyzeModuleIntelligenceUseCase(
      dataRepository,
      aiAdapter,
      planQuotaGuard,
    );

  const streamCopilotUseCase =
    options.streamCopilotUseCase ??
    new StreamBusinessCopilotUseCase(
      businessMetricsProvider,
      dataRepository,
      aiAdapter,
      planQuotaGuard,
    );

  app.get(
    "/v1/intelligence/insights",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "List proactive AI insights for the authenticated tenant",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            module: {
              type: "string",
              enum: [
                "WHATSAPP",
                "AGENDA",
                "FINANCE",
                "CLIENTS",
                "SERVICES",
                "INVENTORY",
                "TEAM",
              ],
            },
            status: {
              type: "string",
              enum: ["PENDING", "EXECUTED", "DISMISSED"],
            },
            limit: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              insights: { type: "array", items: { type: "object", additionalProperties: true } },
              pendingCount: { type: "integer" },
            },
            required: ["insights", "pendingCount"],
          },
          400: badRequestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const parsed = listInsightsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Parâmetros de filtro inválidos.",
          issues: parsed.error.issues,
        });
      }

      const result = await proactiveIntelligenceUseCase.listInsights({
        tenantId,
        module: parsed.data.module,
        status: parsed.data.status,
        limit: parsed.data.limit,
      });

      return reply.status(200).send(result);
    },
  );

  app.post(
    "/v1/intelligence/insights/refresh",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "Trigger an immediate proactive intelligence scan for the authenticated tenant",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              tenantId: { type: "string" },
              createdCount: { type: "integer" },
              skippedDuplicateCount: { type: "integer" },
              insights: { type: "array", items: { type: "object", additionalProperties: true } },
            },
            required: [
              "tenantId",
              "createdCount",
              "skippedDuplicateCount",
              "insights",
            ],
          },
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const result = await proactiveIntelligenceUseCase.refreshForTenant(tenantId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/v1/intelligence/insights/:id/execute",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "Execute the action linked to a proactive insight and mark it as EXECUTED",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              insight: { type: "object", additionalProperties: true },
              dispatchedMessagesCount: { type: "integer" },
              skippedQuotaCount: { type: "integer" },
            },
            required: [
              "insight",
              "dispatchedMessagesCount",
              "skippedQuotaCount",
            ],
          },
          400: badRequestResponseSchema,
          402: {
            type: "object",
            properties: { message: { type: "string" } },
          },
          404: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const parsed = insightIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Identificador do insight inválido.",
        });
      }

      try {
        const result = await proactiveIntelligenceUseCase.executeInsight(
          tenantId,
          parsed.data.id,
        );
        return reply.status(200).send(result);
      } catch (error) {
        if (error instanceof ProactiveInsightNotFoundError) {
          return reply.status(404).send({ message: error.message });
        }
        if (error instanceof ProactiveInsightQuotaExceededError) {
          return reply.status(402).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/intelligence/insights/:id/dismiss",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "Dismiss a proactive insight for the authenticated tenant",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              insight: { type: "object", additionalProperties: true },
            },
            required: ["insight"],
          },
          400: badRequestResponseSchema,
          404: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const parsed = insightIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Identificador do insight inválido.",
        });
      }

      try {
        const insight = await proactiveIntelligenceUseCase.dismissInsight(
          tenantId,
          parsed.data.id,
        );
        return reply.status(200).send({ insight });
      } catch (error) {
        if (error instanceof ProactiveInsightNotFoundError) {
          return reply.status(404).send({ message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/intelligence/modules/:module/analyze",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "Run instant AI analysis on aggregated SQL metrics for a specific module",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          properties: {
            module: { type: "string", enum: [...INTELLIGENCE_MODULES] },
          },
          required: ["module"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              module: { type: "string" },
              headline: { type: "string" },
              insights: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    detail: { type: "string" },
                    severity: {
                      type: "string",
                      enum: ["INFO", "OPPORTUNITY", "WARNING"],
                    },
                  },
                  required: ["title", "detail", "severity"],
                },
              },
              recommendedAction: { type: "string" },
              provider: { type: "string", enum: ["GEMINI", "LOCAL_ANALYTICS"] },
            },
            required: [
              "module",
              "headline",
              "insights",
              "recommendedAction",
              "provider",
            ],
          },
          400: badRequestResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const parsed = moduleAnalyzeParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          message:
            "Módulo inválido. Use AGENDA, FINANCE, CLIENTS, SERVICES, INVENTORY ou TEAM.",
        });
      }

      const result = await analyzeModuleUseCase.execute(
        tenantId,
        parsed.data.module,
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/v1/intelligence/copilot/stream",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Intelligence"],
        summary: "Contextual AI Business Copilot with Server-Sent Events (SSE) streaming",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          properties: {
            message: { type: "string", minLength: 1, maxLength: 2000 },
            currentModule: { type: "string", enum: [...INTELLIGENCE_MODULES] },
            history: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                properties: {
                  role: { type: "string", enum: ["user", "assistant"] },
                  content: { type: "string" },
                },
                required: ["role", "content"],
              },
            },
          },
          required: ["message"],
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const parsed = copilotStreamBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          message: "Payload inválido para o Copiloto IA.",
          issues: parsed.error.issues,
        });
      }

      // Assume controle direto do stream HTTP para emitir eventos SSE palavra por palavra.
      reply.hijack();

      const origin = request.headers.origin;
      const headers: Record<string, string> = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      };
      if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
      }

      reply.raw.writeHead(200, headers);

      try {
        for await (const chunk of streamCopilotUseCase.execute({
          tenantId,
          message: parsed.data.message,
          currentModule: parsed.data.currentModule,
          history: parsed.data.history,
        })) {
          reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
        }

        reply.raw.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      } catch (error) {
        request.log.error(error, "[Intelligence] Falha no streaming SSE do Copiloto IA");
        reply.raw.write(
          `data: ${JSON.stringify({ error: "Falha ao processar resposta do Copiloto IA.", done: true })}\n\n`,
        );
      } finally {
        reply.raw.end();
      }
    },
  );
}
