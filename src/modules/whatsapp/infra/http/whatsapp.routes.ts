import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isProduction } from "../../../../shared/config/env.js";
import {
  authenticate,
  authorizeRoles,
} from "../../../../shared/http/auth/authenticate.js";
import { DrizzleClientsRepository } from "../../../clients/infra/database/repositories/drizzle-clients.repository.js";
import { AnalyzeWhatsAppConversationUseCase } from "../../application/use-cases/analyze-whatsapp-conversation.use-case.js";
import { AskBusinessCopilotUseCase } from "../../application/use-cases/ask-business-copilot.use-case.js";
import { ConfigureDatafyWhatsAppUseCase } from "../../application/use-cases/configure-datafy-whatsapp.use-case.js";
import { ConnectEvolutionWhatsAppUseCase } from "../../application/use-cases/connect-evolution-whatsapp.use-case.js";
import { DisconnectEvolutionWhatsAppUseCase } from "../../application/use-cases/disconnect-evolution-whatsapp.use-case.js";
import { GetWhatsAppConnectionUseCase } from "../../application/use-cases/get-whatsapp-connection.use-case.js";
import { GetWhatsAppConversationMessagesUseCase } from "../../application/use-cases/get-whatsapp-conversation-messages.use-case.js";
import { GetWhatsAppIntelligenceSummaryUseCase } from "../../application/use-cases/get-whatsapp-intelligence-summary.use-case.js";
import { ListWhatsAppConversationsUseCase } from "../../application/use-cases/list-whatsapp-conversations.use-case.js";
import { ProcessInboundWhatsAppMessageUseCase } from "../../application/use-cases/process-inbound-whatsapp-message.use-case.js";
import { SendOwnerWhatsAppMessageUseCase } from "../../application/use-cases/send-owner-whatsapp-message.use-case.js";
import { SendWhatsAppFollowupUseCase } from "../../application/use-cases/send-whatsapp-followup.use-case.js";
import { UpdateWhatsAppConversationModeUseCase } from "../../application/use-cases/update-whatsapp-conversation-mode.use-case.js";
import { UpdateWhatsAppSettingsUseCase } from "../../application/use-cases/update-whatsapp-settings.use-case.js";
import { ResilientBusinessCopilotAdapter } from "../ai/business-copilot.adapter.js";
import { ResilientConversationAnalyzerAdapter } from "../ai/conversation-analyzer.adapter.js";
import { createAiBookingAgentAdapter } from "../ai/create-ai-booking-agent.js";
import { DrizzleAiBookingContextProvider } from "../ai/drizzle-ai-booking-context.provider.js";
import { DrizzleBusinessMetricsProvider } from "../ai/drizzle-business-metrics.provider.js";
import { AesSecretCipher } from "../crypto/aes-secret-cipher.js";
import { DrizzleAiConversationInsightsRepository } from "../database/repositories/drizzle-ai-conversation-insights.repository.js";
import { DrizzleCompanyWhatsAppConnectionRepository } from "../database/repositories/drizzle-company-whatsapp-connection.repository.js";
import { DrizzleWhatsAppConversationsRepository } from "../database/repositories/drizzle-whatsapp-conversations.repository.js";
import { DrizzleWhatsAppMessagesRepository } from "../database/repositories/drizzle-whatsapp-messages.repository.js";
import { DatafyWhatsAppAdapter } from "../whatsapp/datafy-whatsapp.adapter.js";
import { EvolutionWhatsAppAdapter } from "../whatsapp/evolution-whatsapp.adapter.js";
import { WhatsAppGatewayRouter } from "../whatsapp/whatsapp-gateway-router.js";

const datafyPatchSchema = z.object({
  enabled: z.boolean().optional(),
  datafyInstanceId: z.string().trim().max(160).nullable().optional(),
  datafyApiToken: z.string().trim().max(512).nullable().optional(),
});

const settingsPatchSchema = z
  .object({
    aiAutopilotEnabled: z.boolean().optional(),
    aiSystemPrompt: z.string().max(4000).nullable().optional(),
  })
  .refine(
    (payload) =>
      payload.aiAutopilotEnabled !== undefined ||
      payload.aiSystemPrompt !== undefined,
    { message: "Informe ao menos uma configuração para atualizar." },
  );

const listConversationsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  assignedMode: z.enum(["AI_AUTOPILOT", "HUMAN"]).optional(),
});

const conversationIdParamSchema = z.object({
  id: z.string().uuid(),
});

const sendOwnerMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

const updateModeBodySchema = z.object({
  assignedMode: z.enum(["AI_AUTOPILOT", "HUMAN"]),
});

const simulatorInboundBodySchema = z.object({
  phone: z.string().trim().min(10).max(32),
  contactName: z.string().trim().max(120).optional(),
  content: z.string().trim().min(1).max(4000),
});

const intelligenceSummaryQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional(),
});

const sendFollowupBodySchema = z.object({
  content: z.string().trim().min(1).max(4000).optional(),
});

const copilotChatBodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
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

interface EvolutionWebhookPayload {
  event?: string;
  instance?: string;
  apikey?: string;
  data?: {
    key?: {
      id?: string;
      fromMe?: boolean;
      remoteJid?: string;
      remoteJidAlt?: string;
    };
    pushName?: string;
    messageTimestamp?: number | string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      imageMessage?: { caption?: string };
      videoMessage?: { caption?: string };
      buttonsResponseMessage?: { selectedDisplayText?: string };
      listResponseMessage?: { title?: string };
    };
  };
}

function extractEvolutionText(
  message: NonNullable<EvolutionWebhookPayload["data"]>["message"],
): string | null {
  if (!message) return null;
  const raw =
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    null;

  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function extractPhoneFromJid(jid?: string): string | null {
  if (!jid) return null;
  // Ignora grupos (@g.us) e broadcasts/status
  if (jid.includes("@g.us") || jid.includes("status@broadcast")) {
    return null;
  }
  const digits = jid.replace(/@.*$/, "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return `+${digits}`;
}

const ownerGuard = [authenticate, authorizeRoles("OWNER")];

export async function whatsappRoutes(app: FastifyInstance): Promise<void> {
  const connectionRepository = new DrizzleCompanyWhatsAppConnectionRepository();
  const conversationsRepository = new DrizzleWhatsAppConversationsRepository();
  const messagesRepository = new DrizzleWhatsAppMessagesRepository();
  const insightsRepository = new DrizzleAiConversationInsightsRepository();
  const clientsRepository = new DrizzleClientsRepository();

  const evolutionAdapter = new EvolutionWhatsAppAdapter();
  const datafyAdapter = new DatafyWhatsAppAdapter();
  const secretCipher = new AesSecretCipher();
  const gatewayRouter = new WhatsAppGatewayRouter(
    connectionRepository,
    evolutionAdapter,
    datafyAdapter,
    secretCipher,
  );
  const aiAgent = createAiBookingAgentAdapter();
  const aiContextProvider = new DrizzleAiBookingContextProvider();
  const conversationAnalyzer = new ResilientConversationAnalyzerAdapter();
  const businessMetricsProvider = new DrizzleBusinessMetricsProvider();
  const businessCopilotAdapter = new ResilientBusinessCopilotAdapter();

  const analyzeConversationUseCase = new AnalyzeWhatsAppConversationUseCase(
    conversationsRepository,
    messagesRepository,
    insightsRepository,
    conversationAnalyzer,
  );
  const getIntelligenceSummaryUseCase =
    new GetWhatsAppIntelligenceSummaryUseCase(
      conversationsRepository,
      insightsRepository,
    );
  const sendFollowupUseCase = new SendWhatsAppFollowupUseCase(
    conversationsRepository,
    messagesRepository,
    insightsRepository,
    gatewayRouter,
    analyzeConversationUseCase,
  );
  const askBusinessCopilotUseCase = new AskBusinessCopilotUseCase(
    businessMetricsProvider,
    businessCopilotAdapter,
  );

  const getConnectionUseCase = new GetWhatsAppConnectionUseCase(
    connectionRepository,
    evolutionAdapter,
  );
  const connectEvolutionUseCase = new ConnectEvolutionWhatsAppUseCase(
    connectionRepository,
    evolutionAdapter,
  );
  const disconnectEvolutionUseCase = new DisconnectEvolutionWhatsAppUseCase(
    connectionRepository,
    evolutionAdapter,
  );
  const configureDatafyUseCase = new ConfigureDatafyWhatsAppUseCase(
    connectionRepository,
    datafyAdapter,
    secretCipher,
    () => evolutionAdapter.getMode(),
  );
  const updateSettingsUseCase = new UpdateWhatsAppSettingsUseCase(
    connectionRepository,
    () => evolutionAdapter.getMode(),
  );

  const processInboundUseCase = new ProcessInboundWhatsAppMessageUseCase(
    clientsRepository,
    connectionRepository,
    conversationsRepository,
    messagesRepository,
    aiAgent,
    aiContextProvider,
    gatewayRouter,
    analyzeConversationUseCase,
  );
  const listConversationsUseCase = new ListWhatsAppConversationsUseCase(
    conversationsRepository,
  );
  const getConversationMessagesUseCase =
    new GetWhatsAppConversationMessagesUseCase(
      conversationsRepository,
      messagesRepository,
    );
  const sendOwnerMessageUseCase = new SendOwnerWhatsAppMessageUseCase(
    conversationsRepository,
    messagesRepository,
    gatewayRouter,
    analyzeConversationUseCase,
  );
  const updateConversationModeUseCase =
    new UpdateWhatsAppConversationModeUseCase(conversationsRepository);

  // =========================================================================
  // Bloco 1: Conexão Evolution / Datafy e configurações de IA
  // =========================================================================
  app.get(
    "/v1/whatsapp/connection",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Get Evolution and Datafy connection statuses and channel settings",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      return getConnectionUseCase.execute(request.actor!.companyId);
    },
  );

  app.post(
    "/v1/whatsapp/evolution/connect",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Create/start Evolution instance for the company and return QR code or connected status",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      return connectEvolutionUseCase.execute(request.actor!.companyId);
    },
  );

  app.post(
    "/v1/whatsapp/evolution/disconnect",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary: "Disconnect company Evolution WhatsApp instance",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      return disconnectEvolutionUseCase.execute(request.actor!.companyId);
    },
  );

  app.patch(
    "/v1/whatsapp/datafy",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary: "Save and validate official Datafy campaign credentials",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = datafyPatchSchema.parse(request.body ?? {});
      return configureDatafyUseCase.execute({
        companyId: request.actor!.companyId,
        enabled: payload.enabled,
        datafyInstanceId: payload.datafyInstanceId,
        datafyApiToken: payload.datafyApiToken,
      });
    },
  );

  app.patch(
    "/v1/whatsapp/settings",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Update WhatsApp AI autopilot toggle and barbershop instructions",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = settingsPatchSchema.parse(request.body ?? {});
      return updateSettingsUseCase.execute({
        companyId: request.actor!.companyId,
        aiAutopilotEnabled: payload.aiAutopilotEnabled,
        aiSystemPrompt: payload.aiSystemPrompt,
      });
    },
  );

  // =========================================================================
  // Bloco 2: Webhook Entrante Público (Evolution API)
  // =========================================================================
  app.post(
    "/v1/webhooks/whatsapp/evolution",
    {
      schema: {
        tags: ["WhatsApp (Webhooks)"],
        summary:
          "Public webhook endpoint for Evolution API MESSAGES_UPSERT events",
      },
    },
    async (request, reply) => {
      const payload = (request.body ?? {}) as EvolutionWebhookPayload;

      // Valida segredo compartilhado quando configurado no ambiente (ou em produção)
      const expectedToken =
        process.env.WHATSAPP_EVOLUTION_WEBHOOK_TOKEN?.trim() ||
        process.env.WHATSAPP_EVOLUTION_API_KEY?.trim();

      if (expectedToken) {
        const providedToken =
          String(request.headers["x-webhook-token"] ?? "").trim() ||
          String(request.headers["apikey"] ?? "").trim() ||
          String(
            (request.query as Record<string, unknown> | undefined)?.token ?? "",
          ).trim() ||
          String(payload.apikey ?? "").trim();

        if (providedToken !== expectedToken) {
          return reply.status(401).send({
            message: "Webhook token inválido.",
          });
        }
      } else if (isProduction()) {
        return reply.status(503).send({
          message: "Webhook Evolution não configurado em produção.",
        });
      }

      const eventName = (payload.event ?? "").toUpperCase().replace(/\./g, "_");
      if (eventName !== "MESSAGES_UPSERT") {
        return reply.status(200).send({ ignored: true, reason: "EVENT_IGNORED" });
      }

      if (payload.data?.key?.fromMe === true) {
        return reply.status(200).send({ ignored: true, reason: "FROM_ME" });
      }

      const instanceName = payload.instance?.trim();
      if (!instanceName) {
        return reply
          .status(400)
          .send({ message: "Instância Evolution ausente no payload." });
      }

      const connection =
        await connectionRepository.findByEvolutionInstanceName(instanceName);
      if (!connection) {
        return reply
          .status(200)
          .send({ ignored: true, reason: "UNKNOWN_INSTANCE" });
      }

      const phone =
        extractPhoneFromJid(payload.data?.key?.remoteJid) ??
        extractPhoneFromJid(payload.data?.key?.remoteJidAlt);
      const text = extractEvolutionText(payload.data?.message);

      if (!phone || !text) {
        return reply
          .status(200)
          .send({ ignored: true, reason: "UNSUPPORTED_MESSAGE" });
      }

      const timestampRaw = payload.data?.messageTimestamp;
      const timestampSeconds =
        typeof timestampRaw === "number"
          ? timestampRaw
          : typeof timestampRaw === "string"
            ? Number(timestampRaw)
            : NaN;
      const sentAt = Number.isFinite(timestampSeconds)
        ? new Date(timestampSeconds * 1000)
        : new Date();

      const result = await processInboundUseCase.execute({
        companyId: connection.companyId,
        phone,
        contactName: payload.data?.pushName ?? null,
        content: text,
        externalMessageId: payload.data?.key?.id ?? null,
        sentAt,
        source: "WEBHOOK",
      });

      return reply.status(200).send({
        accepted: true,
        duplicated: result.duplicated,
        conversationId: result.conversation.id,
        aiScheduled: result.aiScheduled,
      });
    },
  );

  // =========================================================================
  // Bloco 2: Inbox & Simulador (Endpoints Owner)
  // =========================================================================
  app.get(
    "/v1/whatsapp/conversations",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "List company WhatsApp conversations ordered by last_message_at DESC",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const query = listConversationsQuerySchema.parse(request.query ?? {});
      return listConversationsUseCase.execute({
        companyId: request.actor!.companyId,
        search: query.search,
        assignedMode: query.assignedMode,
      });
    },
  );

  app.get(
    "/v1/whatsapp/conversations/:id/messages",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Get message history for a conversation and reset unread_count",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { id } = conversationIdParamSchema.parse(request.params);
      return getConversationMessagesUseCase.execute({
        companyId: request.actor!.companyId,
        conversationId: id,
      });
    },
  );

  app.post(
    "/v1/whatsapp/conversations/:id/messages",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Send a manual owner message, switch conversation to HUMAN mode, and dispatch via gateway",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { id } = conversationIdParamSchema.parse(request.params);
      const body = sendOwnerMessageBodySchema.parse(request.body ?? {});
      const result = await sendOwnerMessageUseCase.execute({
        companyId: request.actor!.companyId,
        conversationId: id,
        content: body.content,
      });
      return reply.status(201).send(result);
    },
  );

  app.patch(
    "/v1/whatsapp/conversations/:id/mode",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary: "Toggle conversation assigned mode between AI_AUTOPILOT and HUMAN",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { id } = conversationIdParamSchema.parse(request.params);
      const body = updateModeBodySchema.parse(request.body ?? {});
      return updateConversationModeUseCase.execute({
        companyId: request.actor!.companyId,
        conversationId: id,
        assignedMode: body.assignedMode,
      });
    },
  );

  app.post(
    "/v1/whatsapp/simulator/inbound",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp (Owner)"],
        summary:
          "Simulate an inbound client WhatsApp message running the full real AI and agenda pipeline locally",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const body = simulatorInboundBodySchema.parse(request.body ?? {});
      const result = await processInboundUseCase.execute({
        companyId: request.actor!.companyId,
        phone: body.phone,
        contactName: body.contactName ?? null,
        content: body.content,
        source: "SIMULATOR",
        debounceMs: 0,
      });
      return reply.status(201).send(result);
    },
  );

  // =========================================================================
  // Bloco 3: WhatsApp Intelligence & Copiloto IA de Gestão (Endpoints Owner)
  // =========================================================================
  app.get(
    "/v1/whatsapp/intelligence/summary",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp Intelligence (Owner)"],
        summary:
          "Get WhatsApp conversion funnel KPIs, objections breakdown, stalled leads, and AI insights",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            days: { type: "integer", minimum: 1, maximum: 365, default: 30 },
          },
        },
      },
    },
    async (request) => {
      const query = intelligenceSummaryQuerySchema.parse(request.query ?? {});
      return getIntelligenceSummaryUseCase.execute({
        companyId: request.actor!.companyId,
        days: query.days,
      });
    },
  );

  app.post(
    "/v1/whatsapp/conversations/:id/followup",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp Intelligence (Owner)"],
        summary:
          "Send a 1-click AI-suggested (or custom) follow-up message to a WhatsApp conversation",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          properties: {
            content: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = conversationIdParamSchema.parse(request.params);
      const body = sendFollowupBodySchema.parse(request.body ?? {});
      const result = await sendFollowupUseCase.execute({
        companyId: request.actor!.companyId,
        conversationId: id,
        content: body.content,
      });
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/v1/ai/copilot/chat",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["AI Copilot (Owner)"],
        summary:
          "Ask the Business Management AI Copilot questions grounded in real company metrics",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string", minLength: 1, maxLength: 2000 },
            history: {
              type: "array",
              maxItems: 20,
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: { type: "string", enum: ["user", "assistant"] },
                  content: { type: "string", minLength: 1, maxLength: 4000 },
                },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const body = copilotChatBodySchema.parse(request.body ?? {});
      return askBusinessCopilotUseCase.execute({
        companyId: request.actor!.companyId,
        message: body.message,
        history: body.history,
      });
    },
  );
}
