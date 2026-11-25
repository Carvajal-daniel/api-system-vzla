import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetActorStatusVerifier,
  setActorStatusVerifier,
} from "../../../shared/http/auth/authenticate.js";
import type {
  TenantWhatsAppChannelProvider,
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
  UpsertTenantWhatsAppChannelInput,
} from "../domain/repositories/tenant-whatsapp-channels.repository.js";
import {
  buildTenantEvolutionInstanceName,
  EvolutionApiUnreachableError,
  EvolutionWhatsAppAdapter,
  extractEvolutionQrCode,
  formatEvolutionPhoneNumber,
} from "../infra/adapters/whatsapp/evolution-whatsapp.adapter.js";
import { WhatsAppAiTurnOrchestrator } from "../application/services/whatsapp-ai-turn-orchestrator.js";
import {
  buildAiBookingSystemPrompt,
  normalizeWhatsAppFormatting,
} from "../infra/ai/ai-booking-tool-definitions.js";
import { registerEvolutionChannelsWebhookRoutes } from "../infra/http/evolution-channels-webhook.routes.js";

class InMemoryTenantWhatsAppChannelsRepository
  implements TenantWhatsAppChannelsRepository
{
  constructor(public readonly channels: TenantWhatsAppChannelRecord[] = []) {}

  async listByTenant(tenantId: string): Promise<TenantWhatsAppChannelRecord[]> {
    return this.channels.filter((channel) => channel.tenantId === tenantId);
  }

  async listConnectedByTenant(
    tenantId: string,
  ): Promise<TenantWhatsAppChannelRecord[]> {
    return this.channels.filter(
      (channel) =>
        channel.tenantId === tenantId && channel.status === "CONNECTED",
    );
  }

  async findByTenantAndProvider(
    tenantId: string,
    provider: TenantWhatsAppChannelProvider,
  ): Promise<TenantWhatsAppChannelRecord | null> {
    return (
      this.channels.find(
        (channel) =>
          channel.tenantId === tenantId && channel.provider === provider,
      ) ?? null
    );
  }

  async findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<TenantWhatsAppChannelRecord | null> {
    return (
      this.channels.find(
        (channel) =>
          channel.provider === "EVOLUTION" &&
          channel.credentials["instanceName"] === instanceName,
      ) ?? null
    );
  }

  async upsertChannel(
    input: UpsertTenantWhatsAppChannelInput,
  ): Promise<TenantWhatsAppChannelRecord> {
    const existing = await this.findByTenantAndProvider(
      input.tenantId,
      input.provider,
    );
    const now = new Date();
    if (existing) {
      existing.status = input.status;
      if (input.purpose) existing.purpose = input.purpose;
      if (input.phoneNumber !== undefined) existing.phoneNumber = input.phoneNumber;
      if (input.credentials) {
        existing.credentials = { ...existing.credentials, ...input.credentials };
      }
      existing.updatedAt = now;
      return existing;
    }

    const created: TenantWhatsAppChannelRecord = {
      id: `ch-${this.channels.length + 1}`,
      tenantId: input.tenantId,
      provider: input.provider,
      purpose: input.purpose ?? "ALL",
      phoneNumber: input.phoneNumber ?? null,
      status: input.status,
      credentials: input.credentials ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.channels.push(created);
    return created;
  }
}

describe("EvolutionWhatsAppAdapter (REST API v2)", () => {
  const tenantId = "11111111-2222-4333-8444-555555555555";
  const instanceName = buildTenantEvolutionInstanceName(tenantId);
  const now = new Date("2026-11-25T18:00:00.000Z");

  it("normalizes phone numbers to international format without '+' or duplicate suffixes", () => {
    expect(formatEvolutionPhoneNumber("+55 (11) 99999-0000")).toBe(
      "5511999990000",
    );
    expect(formatEvolutionPhoneNumber("11988887777")).toBe("5511988887777");
    expect(formatEvolutionPhoneNumber("5511988887777@s.whatsapp.net")).toBe(
      "5511988887777",
    );
    expect(() => formatEvolutionPhoneNumber("123")).toThrow();
  });

  it("sends text messages via POST /message/sendText/:instance and returns externalMessageId", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-evo-1",
        tenantId,
        provider: "EVOLUTION",
        purpose: "ALL",
        phoneNumber: "+5511900000001",
        status: "CONNECTED",
        credentials: { instanceName },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({ key: { id: "BAE5F1234567890" } }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8080",
      apiKey: "evo-global-secret",
      webhookSecret: "wh-secret-123",
      backendPublicUrl: "http://host.docker.internal:5148",
    }));

    const result = await adapter.sendText({
      tenantId,
      to: "+55 (11) 98765-4321",
      text: "Olá! Seu horário foi confirmado.",
    });

    expect(result).toEqual({ externalMessageId: "BAE5F1234567890" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:8080/message/sendText/${instanceName}`);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ apikey: "evo-global-secret" });
    expect(JSON.parse(String(init.body))).toEqual({
      number: "5511987654321",
      text: "Olá! Seu horário foi confirmado.",
      linkPreview: false,
    });
  });

  it("sends composing presence via POST /chat/sendPresence/:instance with delay 5000", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-evo-2",
        tenantId,
        provider: "EVOLUTION",
        purpose: "ALL",
        phoneNumber: "+5511900000001",
        status: "CONNECTED",
        credentials: { instanceName },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ presence: "composing" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8080",
      apiKey: "evo-global-secret",
    }));

    await adapter.sendPresence({
      tenantId,
      to: "11999998888",
      presence: "composing",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe(
      `http://localhost:8080/chat/sendPresence/${instanceName}`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      number: "5511999998888",
      presence: "composing",
      delay: 5000,
    });
  });

  it("renders template variables into text and dispatches via sendText", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-evo-3",
        tenantId,
        provider: "EVOLUTION",
        purpose: "ALL",
        phoneNumber: "+5511900000001",
        status: "CONNECTED",
        credentials: { instanceName },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ key: { id: "TPL_MSG_1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8080",
      apiKey: "evo-global-secret",
    }));

    const result = await adapter.sendTemplate({
      tenantId,
      to: "+5511912345678",
      templateName: "lembrete_corte",
      variables: {
        body: "Olá {{name}}, seu horário é às {{time}}.",
        name: "Lucas",
        time: "15:00",
      },
    });

    expect(result).toEqual({ externalMessageId: "TPL_MSG_1" });
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      number: "5511912345678",
      text: "Olá Lucas, seu horário é às 15:00.",
    });
  });

  it("extracts QR Code across Evolution v2 formats (qrcode.base64, base64, code)", () => {
    expect(
      extractEvolutionQrCode({ qrcode: { base64: "iVBORw0KGgoAAA" } }),
    ).toBe("data:image/png;base64,iVBORw0KGgoAAA");
    expect(
      extractEvolutionQrCode({ base64: "data:image/png;base64,AAAA" }),
    ).toBe("data:image/png;base64,AAAA");
    expect(extractEvolutionQrCode({ code: "2@raw-qr-payload-v2" })).toBe(
      "2@raw-qr-payload-v2",
    );
    expect(extractEvolutionQrCode({})).toBeNull();
  });

  it.each([400, 403, 409])(
    "falls back to GET /instance/connect when POST /instance/create returns %i (existing instance) and ignores webhook/set failure without breaking QR Code",
    async (createStatus) => {
      const repo = new InMemoryTenantWhatsAppChannelsRepository();
      const logger = { warn: vi.fn() };

      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith("/instance/create")) {
          return new Response(
            JSON.stringify({ message: "Instance already exists" }),
            { status: createStatus },
          );
        }
        if (url.includes("/webhook/set/")) {
          return new Response(
            JSON.stringify({ message: "Webhook validation warning" }),
            { status: 400 },
          );
        }
        if (url.includes("/instance/connect/")) {
          return new Response(
            JSON.stringify({
              code: "2@qr-code-fallback",
              pairingCode: "ABCD-1234",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected URL: ${url}`);
      }) as unknown as typeof fetch;

      const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
        apiUrl: "http://localhost:8085",
        apiKey: "evo-global-secret",
        webhookSecret: "wh-secret-123",
        backendPublicUrl: "http://host.docker.internal:5148",
      }));

      const result = await adapter.connectInstance(
        tenantId,
        instanceName,
        logger,
      );

      expect(result).toEqual({
        instanceName,
        qrCodeBase64: "2@qr-code-fallback",
        pairingCode: "ABCD-1234",
        status: "QRCODE_PENDING",
        phoneNumber: null,
      });

      const calls = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
        .calls as [string, RequestInit][];
      expect(calls).toHaveLength(3);
      expect(calls[1]?.[0]).toBe(
        `http://localhost:8085/webhook/set/${instanceName}`,
      );
      expect(JSON.parse(String(calls[1]?.[1].body))).toEqual({
        webhook: {
          enabled: true,
          url: "http://host.docker.internal:5148/v1/whatsapp/webhooks/evolution?secret=wh-secret-123",
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        },
      });
      expect(logger.warn).toHaveBeenCalledTimes(2);
    },
  );

  it("throws EvolutionApiUnreachableError on ECONNREFUSED network failure", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository();
    const networkErr = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    const fetchMock = vi.fn(async () => {
      throw networkErr;
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8085",
      apiKey: "evo-global-secret",
    }));

    await expect(
      adapter.connectInstance(tenantId, instanceName),
    ).rejects.toBeInstanceOf(EvolutionApiUnreachableError);
  });

  it("maps Evolution v2 GET /instance/connectionState payloads (open, connecting, close) accurately", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository();
    const responses = [
      {
        instance: {
          instanceName,
          state: "open",
          ownerJid: "558597926400@s.whatsapp.net",
        },
      },
      {
        instance: {
          instanceName,
          state: "connecting",
        },
      },
      {
        instance: {
          instanceName,
          connectionStatus: "open",
          owner: "5511999990000@s.whatsapp.net",
        },
      },
      {
        instance: {
          instanceName,
          state: "close",
        },
      },
    ];
    let idx = 0;
    const fetchMock = vi.fn(async () => {
      const payload = responses[idx++];
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8085",
      apiKey: "evo-global-key",
    }));

    expect(await adapter.getInstanceConnectionState(instanceName)).toEqual({
      instanceName,
      status: "CONNECTED",
      phoneNumber: "+558597926400",
    });
    expect(await adapter.getInstanceConnectionState(instanceName)).toEqual({
      instanceName,
      status: "QRCODE_PENDING",
      phoneNumber: null,
    });
    expect(await adapter.getInstanceConnectionState(instanceName)).toEqual({
      instanceName,
      status: "CONNECTED",
      phoneNumber: "+5511999990000",
    });
    expect(await adapter.getInstanceConnectionState(instanceName)).toEqual({
      instanceName,
      status: "DISCONNECTED",
      phoneNumber: null,
    });
  });
});

describe("Webhook POST /v1/whatsapp/webhooks/evolution", () => {
  const tenantA = "aaaaaaaa-1111-4111-8111-111111111111";
  const tenantB = "bbbbbbbb-2222-4222-8222-222222222222";
  const instanceA = buildTenantEvolutionInstanceName(tenantA);
  const instanceB = buildTenantEvolutionInstanceName(tenantB);
  const webhookSecret = "super_secure_webhook_secret_2026";
  const now = new Date("2026-11-25T18:00:00.000Z");

  async function buildTestApp() {
    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-a",
        tenantId: tenantA,
        provider: "EVOLUTION",
        purpose: "ALL",
        phoneNumber: null,
        status: "QRCODE_PENDING",
        credentials: { instanceName: instanceA },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ch-b",
        tenantId: tenantB,
        provider: "EVOLUTION",
        purpose: "ALL",
        phoneNumber: "+5521999990000",
        status: "CONNECTED",
        credentials: { instanceName: instanceB },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const processInboundSpy = vi.fn(async () => ({
      duplicated: false,
      conversation: {
        id: "conv-123",
      },
      inboundMessage: { id: "msg-1" },
      outboundMessage: null,
      aiScheduled: true,
      aiActions: [],
    }));

    const adapter = new EvolutionWhatsAppAdapter(repo);
    const app = Fastify();
    await registerEvolutionChannelsWebhookRoutes(app, {
      channelsRepository: repo,
      evolutionAdapter: adapter,
      processInboundUseCase: {
        execute: processInboundSpy as never,
      },
      envProvider: () => ({
        apiUrl: "http://localhost:8080",
        apiKey: "evo-key",
        webhookSecret,
        backendPublicUrl: "http://host.docker.internal:5148",
      }),
      isConfiguredProvider: () => true,
    });

    return { app, repo, processInboundSpy };
  }

  it("rejects requests with invalid webhook secret (401)", async () => {
    const { app, processInboundSpy } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/webhooks/evolution?secret=wrong_secret",
      payload: {
        event: "MESSAGES_UPSERT",
        instance: instanceA,
        data: {
          key: {
            id: "msg-1",
            fromMe: false,
            remoteJid: "5511999991111@s.whatsapp.net",
          },
          message: { conversation: "Oi" },
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(processInboundSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("ignores messages sent by the store itself (fromMe: true) and group messages (@g.us)", async () => {
    const { app, processInboundSpy } = await buildTestApp();

    const fromMeResponse = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/webhooks/evolution",
      headers: { "x-webhook-secret": webhookSecret },
      payload: {
        event: "MESSAGES_UPSERT",
        instance: instanceA,
        data: {
          key: {
            id: "msg-self",
            fromMe: true,
            remoteJid: "5511999991111@s.whatsapp.net",
          },
          message: { conversation: "Resposta manual da loja" },
        },
      },
    });

    expect(fromMeResponse.statusCode).toBe(200);
    expect(fromMeResponse.json()).toEqual({ ignored: true, reason: "FROM_ME" });

    const groupResponse = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/webhooks/evolution",
      headers: { apikey: webhookSecret },
      payload: {
        event: "MESSAGES_UPSERT",
        instance: instanceA,
        data: {
          key: {
            id: "msg-group",
            fromMe: false,
            remoteJid: "120363042123456789@g.us",
          },
          message: { conversation: "Mensagem de grupo" },
        },
      },
    });

    expect(groupResponse.statusCode).toBe(200);
    expect(groupResponse.json()).toEqual({
      ignored: true,
      reason: "GROUP_OR_BROADCAST",
    });
    expect(processInboundSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it("updates channel status and phoneNumber on CONNECTION_UPDATE", async () => {
    const { app, repo } = await buildTestApp();

    const openResponse = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/evolution?secret=${webhookSecret}`,
      payload: {
        event: "CONNECTION_UPDATE",
        instance: instanceA,
        data: {
          state: "open",
          wuid: "5511988881234@s.whatsapp.net",
        },
      },
    });

    expect(openResponse.statusCode).toBe(200);
    expect(openResponse.json()).toEqual({
      accepted: true,
      event: "CONNECTION_UPDATE",
      status: "CONNECTED",
    });

    const updated = await repo.findByTenantAndProvider(tenantA, "EVOLUTION");
    expect(updated?.status).toBe("CONNECTED");
    expect(updated?.phoneNumber).toBe("+5511988881234");

    const closeResponse = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/evolution?secret=${webhookSecret}`,
      payload: {
        event: "CONNECTION_UPDATE",
        instance: instanceA,
        data: {
          state: "close",
        },
      },
    });

    expect(closeResponse.statusCode).toBe(200);
    expect(
      (await repo.findByTenantAndProvider(tenantA, "EVOLUTION"))?.status,
    ).toBe("DISCONNECTED");
    await app.close();
  });

  it("routes valid client MESSAGES_UPSERT exclusively to the tenantId resolved from tenant_whatsapp_channels", async () => {
    const { app, processInboundSpy } = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/evolution?secret=${webhookSecret}`,
      payload: {
        event: "MESSAGES_UPSERT",
        instance: instanceB,
        data: {
          key: {
            id: "MSG_EXT_999",
            fromMe: false,
            remoteJid: "5521987654321@s.whatsapp.net",
          },
          pushName: "João Silva",
          messageTimestamp: 1764093600,
          message: {
            extendedTextMessage: {
              text: "Quero agendar corte e barba amanhã às 10h",
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: true,
      duplicated: false,
      conversationId: "conv-123",
      aiScheduled: true,
    });

    expect(processInboundSpy).toHaveBeenCalledTimes(1);
    expect(processInboundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: tenantB,
        phone: "+5521987654321",
        contactName: "João Silva",
        content: "Quero agendar corte e barba amanhã às 10h",
        externalMessageId: "MSG_EXT_999",
        source: "WEBHOOK",
      }),
    );
    await app.close();
  });

  it("accepts lowercase dotted Evolution v2 event names (connection.update and messages.upsert) and remoteJidAlt fallback", async () => {
    const { app, repo, processInboundSpy } = await buildTestApp();

    const connResponse = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/evolution?secret=${webhookSecret}`,
      payload: {
        event: "connection.update",
        instance: instanceA,
        data: {
          state: "open",
          wuid: "5511977776666@s.whatsapp.net",
        },
      },
    });

    expect(connResponse.statusCode).toBe(200);
    expect(connResponse.json()).toEqual({
      accepted: true,
      event: "CONNECTION_UPDATE",
      status: "CONNECTED",
    });
    expect(
      (await repo.findByTenantAndProvider(tenantA, "EVOLUTION"))?.status,
    ).toBe("CONNECTED");

    const msgResponse = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/evolution?secret=${webhookSecret}`,
      payload: {
        event: "messages.upsert",
        instance: instanceB,
        data: {
          key: {
            id: "MSG_DOT_1",
            fromMe: false,
            remoteJid: "12345@lid",
            remoteJidAlt: "5511966665555@s.whatsapp.net",
          },
          pushName: "Carlos",
          message: { conversation: "Tem horário hoje?" },
        },
      },
    });

    expect(msgResponse.statusCode).toBe(200);
    expect(msgResponse.json()).toMatchObject({ accepted: true });
    expect(processInboundSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: tenantB,
        phone: "+5511966665555",
        content: "Tem horário hoje?",
      }),
    );

    await app.close();
  });
});

describe("Owner route POST /v1/whatsapp/channels/evolution/connect error handling", () => {
  const tenantId = "bcae5ba5-1111-4111-8111-111111111111";
  const ownerId = "aaaaaaaa-0000-4000-8000-000000000001";
  const previousJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    resetActorStatusVerifier();
    if (previousJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousJwtSecret;
    }
  });

  function signOwnerToken(): string {
    const secret = "test-jwt-secret-evolution-connect";
    process.env.JWT_SECRET = secret;
    return jwt.sign(
      { sub: ownerId, companyId: tenantId, role: "OWNER" },
      secret,
      { expiresIn: "1h" },
    );
  }

  it("returns 502 with a clear Portuguese message when Evolution API container is unreachable (ECONNREFUSED)", async () => {
    setActorStatusVerifier(async () => true);
    const repo = new InMemoryTenantWhatsAppChannelsRepository();
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    }) as unknown as typeof fetch;

    const adapter = new EvolutionWhatsAppAdapter(repo, fetchMock, () => ({
      apiUrl: "http://localhost:8085",
      apiKey: "evo-key",
    }));

    const app = Fastify();
    await registerEvolutionChannelsWebhookRoutes(app, {
      channelsRepository: repo,
      evolutionAdapter: adapter,
      processInboundUseCase: { execute: vi.fn() as never },
      envProvider: () => ({
        apiUrl: "http://localhost:8085",
        apiKey: "evo-key",
      }),
      isConfiguredProvider: () => true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/channels/evolution/connect",
      headers: { authorization: `Bearer ${signOwnerToken()}` },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      message:
        "Servidor Evolution API inacessível. Verifique se o container Docker está rodando.",
    });

    await app.close();
  });

  it("returns 400 with a clear Portuguese message when Evolution API config is missing inside adapter", async () => {
    setActorStatusVerifier(async () => true);
    const repo = new InMemoryTenantWhatsAppChannelsRepository();
    const adapter = new EvolutionWhatsAppAdapter(repo, globalThis.fetch, () => ({
      apiUrl: undefined,
      apiKey: undefined,
    }));

    const app = Fastify();
    await registerEvolutionChannelsWebhookRoutes(app, {
      channelsRepository: repo,
      evolutionAdapter: adapter,
      processInboundUseCase: { execute: vi.fn() as never },
      envProvider: () => ({}),
      isConfiguredProvider: () => true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/whatsapp/channels/evolution/connect",
      headers: { authorization: `Bearer ${signOwnerToken()}` },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message:
        "Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY).",
    });

    await app.close();
  });
});

describe("WhatsApp AI prompt hygiene, native formatting and orchestrator error logging", () => {
  it("enforces no-thinking-aloud, service duration lookup, and native WhatsApp bold in system prompt", () => {
    const prompt = buildAiBookingSystemPrompt({
      company: {
        companyId: "bcae5ba5-1e4b-446e-93d6-4870b292a7ca",
        companyName: "Tapa no Corte",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: null,
        services: [
          {
            id: "svc-1",
            name: "Combo Corte + Barba",
            priceInCents: 7500,
            durationMinutes: 60,
          },
        ],
        collaborators: [
          {
            id: "col-1",
            name: "Nicolas",
            specialty: "Barbeiro",
            serviceIds: ["svc-1"],
          },
        ],
      },
      client: { id: "cli-1", name: "Daniel", phone: "+5585921842910" },
      history: [],
      latestClientMessage: "Corte + barba às 16:00?",
      now: new Date("2026-11-25T21:00:00.000Z"),
      tools: {} as never,
    });

    expect(prompt).toContain("PROIBIDO PENSAR EM VOZ ALTA");
    expect(prompt).toContain("FORMATAÇÃO NATIVA DE WHATSAPP");
    expect(prompt).toContain("(**texto**)");
    expect(prompt).toContain("(*texto*)");
  });

  it("normalizes accidental **bold** Markdown to native WhatsApp *bold*", () => {
    expect(
      normalizeWhatsAppFormatting(
        "Os horários livres são **15:00** e **17:00** por **R$ 75,00**.",
      ),
    ).toBe("Os horários livres são *15:00* e *17:00* por *R$ 75,00*.");
  });

  it("logs structured error when debounced onFlush callback fails instead of swallowing silently", async () => {
    const logger = { error: vi.fn() };
    const orchestrator = new WhatsAppAiTurnOrchestrator(
      {
        sendText: vi.fn(),
        sendTemplate: vi.fn(),
        sendPresence: vi.fn(),
        getChannelsStatus: vi.fn(),
      },
      { defaultDebounceMs: 10, defaultTypingDelayMs: 0, logger },
    );

    orchestrator.scheduleTurn({
      tenantId: "tenant-1",
      conversationId: "conv-1",
      message: "Oi",
      debounceMs: 10,
      onFlush: async () => {
        throw new Error("Simulated Gemini outage");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        conversationId: "conv-1",
        err: expect.any(Error),
      }),
      "Failed to flush debounced WhatsApp AI turn",
    );
    orchestrator.dispose();
  });
});
