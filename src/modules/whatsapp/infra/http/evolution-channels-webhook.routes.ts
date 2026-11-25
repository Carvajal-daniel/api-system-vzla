import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getEvolutionEnv,
  isEvolutionApiConfigured,
  isProduction,
  type EvolutionEnvConfig,
} from "../../../../shared/config/env.js";
import {
  authenticate,
  authorizeRoles,
} from "../../../../shared/http/auth/authenticate.js";
import type { ProcessInboundWhatsAppMessageUseCase } from "../../application/use-cases/process-inbound-whatsapp-message.use-case.js";
import { WhatsAppChannelUnavailableError } from "../../domain/errors/whatsapp-errors.js";
import type { TenantWhatsAppChannelsRepository } from "../../domain/repositories/tenant-whatsapp-channels.repository.js";
import {
  buildTenantEvolutionInstanceName,
  EvolutionApiConfigError,
  EvolutionApiHttpError,
  EvolutionApiUnreachableError,
  EvolutionWhatsAppAdapter,
  isEvolutionNetworkError,
  mapEvolutionConnectionState,
} from "../adapters/whatsapp/evolution-whatsapp.adapter.js";
import { maskChannelCredentials } from "../adapters/whatsapp/whatsapp-gateway.router.js";

export interface EvolutionWebhookEventPayload {
  event?: string;
  instance?: string;
  apikey?: string;
  sender?: string;
  data?: {
    state?: string;
    status?: string;
    connection?: string;
    wuid?: string;
    owner?: string;
    instance?: {
      state?: string;
      owner?: string;
    };
    key?: {
      id?: string;
      fromMe?: boolean;
      remoteJid?: string;
      remoteJidAlt?: string;
    };
    pushName?: string;
    providerMessageId?: string;
    messageId?: string;
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

export interface EvolutionChannelsWebhookDependencies {
  channelsRepository: TenantWhatsAppChannelsRepository;
  evolutionAdapter: EvolutionWhatsAppAdapter;
  processInboundUseCase: Pick<ProcessInboundWhatsAppMessageUseCase, "execute">;
  envProvider?: () => EvolutionEnvConfig;
  isConfiguredProvider?: () => boolean;
}

const ownerGuard = [authenticate, authorizeRoles("OWNER")];

function timingSafeSecretEquals(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

function buildMockQrSvgDataUri(instanceName: string): string {
  const shortLabel = instanceName.slice(0, 22);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">',
    '<rect width="240" height="240" rx="16" fill="#ffffff"/>',
    '<rect x="16" y="16" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="26" y="26" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="36" y="36" width="20" height="20" fill="#0f172a"/>',
    '<rect x="164" y="16" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="174" y="26" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="184" y="36" width="20" height="20" fill="#0f172a"/>',
    '<rect x="16" y="164" width="60" height="60" rx="6" fill="#0f172a"/>',
    '<rect x="26" y="174" width="40" height="40" rx="3" fill="#ffffff"/>',
    '<rect x="36" y="184" width="20" height="20" fill="#0f172a"/>',
    '<rect x="96" y="96" width="48" height="48" rx="8" fill="#25D366"/>',
    '<text x="120" y="125" text-anchor="middle" font-family="monospace" font-size="14" font-weight="bold" fill="#0f172a">MOCK</text>',
    `<text x="120" y="232" text-anchor="middle" font-family="monospace" font-size="9" fill="#475569">${shortLabel}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function isGroupOrBroadcastJid(jid?: string): boolean {
  if (!jid) return false;
  return jid.includes("@g.us") || jid.includes("status@broadcast");
}

export function extractCleanPhoneFromJid(jid?: string): string | null {
  // LIDs são identificadores opacos. Use remoteJidAlt quando ele trouxer o telefone real.
  const digits = typeof jid === "string"
    ? /^\+?([1-9]\d{9,14})(?::\d+)?(?:@(?:s\.whatsapp\.net|c\.us))?$/i.exec(jid.trim())?.[1]
    : undefined;
  return digits ? `+${digits}` : null;
}

export function readEvolutionMessageId(data: EvolutionWebhookEventPayload["data"]): string | undefined {
  for (const value of [data?.key?.id, data?.providerMessageId, data?.messageId]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

function extractInboundMessageText(
  message: NonNullable<EvolutionWebhookEventPayload["data"]>["message"],
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

const EVOLUTION_UNREACHABLE_MESSAGE =
  "Servidor Evolution API inacessível. Verifique se o container Docker está rodando.";

const errorResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
};

// Traduz erros de configuração, rede (ECONNREFUSED/timeout) e HTTP da Evolution API em respostas 400/502 claras.
function handleEvolutionAdapterError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof EvolutionApiConfigError) {
    request.log.warn(
      { err: error },
      "Evolution API configuration is missing or incomplete",
    );
    return reply.status(400).send({
      message: error.message,
    });
  }

  if (
    error instanceof EvolutionApiUnreachableError ||
    isEvolutionNetworkError(error)
  ) {
    request.log.error(
      { err: error },
      "Evolution API server is unreachable (network/connection failure)",
    );
    return reply.status(502).send({
      message: EVOLUTION_UNREACHABLE_MESSAGE,
    });
  }

  if (error instanceof EvolutionApiHttpError) {
    request.log.error(
      { err: error, statusCode: error.statusCode, detail: error.detail },
      "Evolution API returned an unexpected HTTP error",
    );
    return reply.status(502).send({
      message: error.message,
    });
  }

  if (error instanceof WhatsAppChannelUnavailableError) {
    request.log.error(
      { err: error },
      "Evolution WhatsApp channel unavailable",
    );
    return reply.status(502).send({
      message: error.message,
    });
  }

  throw error;
}

// Registra os endpoints autenticados de gestão de canais Evolution (QR Code / status / logout)
// e o endpoint público de webhook seguro com isolamento estrito por tenant_whatsapp_channels.
export async function registerEvolutionChannelsWebhookRoutes(
  app: FastifyInstance,
  deps: EvolutionChannelsWebhookDependencies,
): Promise<void> {
  const envProvider = deps.envProvider ?? getEvolutionEnv;
  const isConfigured = deps.isConfiguredProvider ?? isEvolutionApiConfigured;

  app.post(
    "/v1/whatsapp/channels/evolution/connect",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp Channels (Owner)"],
        summary:
          "Create or reuse isolated Evolution API v2 instance, configure webhook, and return QR Code",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              instanceName: { type: "string" },
              qrCodeBase64: { type: ["string", "null"] },
              pairingCode: { type: ["string", "null"] },
              status: {
                type: "string",
                enum: ["CONNECTED", "DISCONNECTED", "QRCODE_PENDING"],
              },
              phoneNumber: { type: ["string", "null"] },
              mode: { type: "string", enum: ["LIVE", "MOCK_READY"] },
            },
          },
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const existing = await deps.channelsRepository.findByTenantAndProvider(
        tenantId,
        "EVOLUTION",
      );
      const existingInstanceName =
        typeof existing?.credentials["instanceName"] === "string"
          ? existing.credentials["instanceName"].trim()
          : null;
      const instanceName =
        existingInstanceName || buildTenantEvolutionInstanceName(tenantId);

      if (!isConfigured()) {
        if (isProduction()) {
          return reply.status(400).send({
            message:
              "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).",
          });
        }

        await deps.channelsRepository.upsertChannel({
          tenantId,
          provider: "EVOLUTION",
          purpose: existing?.purpose ?? "ALL",
          status: "QRCODE_PENDING",
          credentials: { instanceName },
        });

        return {
          instanceName,
          qrCodeBase64: buildMockQrSvgDataUri(instanceName),
          pairingCode: "MOCK-1234",
          status: "QRCODE_PENDING" as const,
          phoneNumber: existing?.phoneNumber ?? null,
          mode: "MOCK_READY" as const,
        };
      }

      try {
        const result = await deps.evolutionAdapter.connectInstance(
          tenantId,
          instanceName,
          request.log,
        );

        await deps.channelsRepository.upsertChannel({
          tenantId,
          provider: "EVOLUTION",
          purpose: existing?.purpose ?? "ALL",
          status: result.status,
          phoneNumber: result.phoneNumber ?? existing?.phoneNumber ?? null,
          credentials: { instanceName: result.instanceName },
        });

        return {
          instanceName: result.instanceName,
          qrCodeBase64: result.qrCodeBase64,
          pairingCode: result.pairingCode,
          status: result.status,
          phoneNumber: result.phoneNumber,
          mode: "LIVE" as const,
        };
      } catch (error) {
        return handleEvolutionAdapterError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/whatsapp/channels/status",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp Channels (Owner)"],
        summary:
          "Sync real Evolution connection state and return masked WhatsApp channel statuses for the tenant",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const tenantId = request.actor!.companyId;
      const evolutionChannel =
        await deps.channelsRepository.findByTenantAndProvider(
          tenantId,
          "EVOLUTION",
        );

      const configured = isConfigured();
      const evolutionInstanceName =
        typeof evolutionChannel?.credentials["instanceName"] === "string"
          ? evolutionChannel.credentials["instanceName"].trim()
          : "";

      if (evolutionChannel && evolutionInstanceName && configured) {
        try {
          const liveState =
            await deps.evolutionAdapter.getInstanceConnectionState(
              evolutionInstanceName,
            );
          await deps.channelsRepository.upsertChannel({
            tenantId,
            provider: "EVOLUTION",
            purpose: evolutionChannel.purpose,
            status: liveState.status,
            phoneNumber:
              liveState.phoneNumber ?? evolutionChannel.phoneNumber ?? null,
            credentials: { instanceName: evolutionInstanceName },
          });
        } catch (error) {
          request.log.warn(
            { tenantId, instanceName: evolutionInstanceName, err: error },
            "Failed to sync live Evolution connection state; returning persisted channel state",
          );
        }
      }

      const channels = await deps.channelsRepository.listByTenant(tenantId);
      return {
        channels: channels.map((channel) => ({
          id: channel.id,
          provider: channel.provider,
          purpose: channel.purpose,
          phoneNumber: channel.phoneNumber,
          status: channel.status,
          credentials: maskChannelCredentials(channel.credentials),
          updatedAt: channel.updatedAt.toISOString(),
        })),
        mode: configured ? ("LIVE" as const) : ("MOCK_READY" as const),
      };
    },
  );

  app.post(
    "/v1/whatsapp/channels/evolution/disconnect",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["WhatsApp Channels (Owner)"],
        summary:
          "Logout Evolution WhatsApp instance for the tenant and mark channel as DISCONNECTED",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", enum: ["DISCONNECTED"] },
            },
          },
          400: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const tenantId = request.actor!.companyId;
      const existing = await deps.channelsRepository.findByTenantAndProvider(
        tenantId,
        "EVOLUTION",
      );
      const instanceName =
        typeof existing?.credentials["instanceName"] === "string"
          ? existing.credentials["instanceName"].trim()
          : buildTenantEvolutionInstanceName(tenantId);

      if (isConfigured()) {
        try {
          await deps.evolutionAdapter.disconnectInstance(instanceName);
        } catch (error) {
          return handleEvolutionAdapterError(error, request, reply);
        }
      }

      await deps.channelsRepository.upsertChannel({
        tenantId,
        provider: "EVOLUTION",
        purpose: existing?.purpose ?? "ALL",
        status: "DISCONNECTED",
        phoneNumber: null,
        credentials: { instanceName },
      });

      return { status: "DISCONNECTED" as const };
    },
  );

  // =========================================================================
  // Webhook Público Seguro da Evolution API v2
  // =========================================================================
  app.post(
    "/v1/whatsapp/webhooks/evolution",
    {
      schema: {
        tags: ["WhatsApp (Webhooks)"],
        summary:
          "Authenticated Evolution API v2 webhook receiver (CONNECTION_UPDATE and MESSAGES_UPSERT)",
      },
    },
    async (request, reply) => {
      const payload = (request.body ?? {}) as EvolutionWebhookEventPayload;
      const expectedSecret = envProvider().webhookSecret;

      if (!expectedSecret) {
        return reply.status(503).send({
          message: "EVOLUTION_WEBHOOK_SECRET não configurado no servidor.",
        });
      }

      const queryObj = (request.query ?? {}) as Record<string, unknown>;
      const providedSecret =
        String(request.headers["x-webhook-secret"] ?? "").trim() ||
        String(request.headers["apikey"] ?? "").trim() ||
        String(queryObj["secret"] ?? "").trim() ||
        String(payload.apikey ?? "").trim();

      // Comparação em tempo constante para evitar vazamento por timing attack.
      if (
        !providedSecret ||
        !timingSafeSecretEquals(providedSecret, expectedSecret)
      ) {
        return reply.status(401).send({
          message: "Webhook secret inválido.",
        });
      }

      const instanceName = payload.instance?.trim();
      if (!instanceName) {
        return reply.status(400).send({
          message: "Instância Evolution ausente no payload.",
        });
      }

      // Regra máxima de isolamento multi-tenant: resolve o tenantId EXCLUSIVAMENTE pela instância no banco.
      const channel =
        await deps.channelsRepository.findByEvolutionInstanceName(instanceName);
      if (!channel) {
        return reply
          .status(200)
          .send({ ignored: true, reason: "UNKNOWN_INSTANCE" });
      }

      const eventName = (payload.event ?? "").toUpperCase().replace(/\./g, "_");

      if (eventName === "CONNECTION_UPDATE") {
        const rawState =
          payload.data?.state ??
          payload.data?.status ??
          payload.data?.connection ??
          payload.data?.instance?.state;
        const nextStatus = mapEvolutionConnectionState(rawState);
        const ownerPhone = extractCleanPhoneFromJid(
          payload.data?.wuid ??
            payload.data?.owner ??
            payload.data?.instance?.owner ??
            payload.sender,
        );

        await deps.channelsRepository.upsertChannel({
          tenantId: channel.tenantId,
          provider: "EVOLUTION",
          purpose: channel.purpose,
          status: nextStatus,
          ...(ownerPhone !== null
            ? { phoneNumber: ownerPhone }
            : nextStatus === "DISCONNECTED"
              ? { phoneNumber: null }
              : {}),
          credentials: { instanceName },
        });

        return reply.status(200).send({
          accepted: true,
          event: "CONNECTION_UPDATE",
          status: nextStatus,
        });
      }

      if (eventName !== "MESSAGES_UPSERT") {
        return reply
          .status(200)
          .send({ ignored: true, reason: "EVENT_IGNORED" });
      }

      if (payload.data?.key?.fromMe === true) {
        return reply.status(200).send({ ignored: true, reason: "FROM_ME" });
      }

      const remoteJid = payload.data?.key?.remoteJid;
      const remoteJidAlt = payload.data?.key?.remoteJidAlt;
      if (isGroupOrBroadcastJid(remoteJid)) {
        return reply
          .status(200)
          .send({ ignored: true, reason: "GROUP_OR_BROADCAST" });
      }

      const phone =
        extractCleanPhoneFromJid(remoteJid) ??
        extractCleanPhoneFromJid(remoteJidAlt);
      const text = extractInboundMessageText(payload.data?.message);

      if (!phone || !text) {
        return reply
          .status(200)
          .send({ ignored: true, reason: "UNSUPPORTED_MESSAGE" });
      }

      const externalMessageId = readEvolutionMessageId(payload.data);
      if (!externalMessageId) {
        return reply.status(200).send({ ignored: true, reason: "MISSING_MESSAGE_ID" });
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

      const result = await deps.processInboundUseCase.execute({
        companyId: channel.tenantId,
        phone,
        contactName: payload.data?.pushName ?? null,
        content: text,
        externalMessageId,
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
}
