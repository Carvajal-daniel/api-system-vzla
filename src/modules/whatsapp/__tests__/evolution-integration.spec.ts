import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type {
  TenantWhatsAppChannelProvider,
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
  UpsertTenantWhatsAppChannelInput,
} from "../domain/repositories/tenant-whatsapp-channels.repository.js";
import {
  buildTenantEvolutionInstanceName,
  EvolutionWhatsAppAdapter,
  formatEvolutionPhoneNumber,
} from "../infra/adapters/whatsapp/evolution-whatsapp.adapter.js";
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
});
