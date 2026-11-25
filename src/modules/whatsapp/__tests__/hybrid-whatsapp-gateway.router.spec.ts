import { describe, expect, it, vi } from "vitest";
import type { WhatsAppGatewayPort } from "../application/ports/whatsapp-gateway.port.js";
import type {
  TenantWhatsAppChannelProvider,
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
  UpsertTenantWhatsAppChannelInput,
} from "../domain/repositories/tenant-whatsapp-channels.repository.js";
import { MockWhatsAppAdapter } from "../infra/adapters/whatsapp/mock-whatsapp.adapter.js";
import { WhatsAppGatewayRouter } from "../infra/adapters/whatsapp/whatsapp-gateway.router.js";

class InMemoryTenantWhatsAppChannelsRepository
  implements TenantWhatsAppChannelsRepository
{
  constructor(private readonly channels: TenantWhatsAppChannelRecord[] = []) {}

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

describe("Hybrid WhatsAppGatewayRouter & MockWhatsAppAdapter", () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const now = new Date("2026-11-25T15:00:00.000Z");

  it("delegates to MockWhatsAppAdapter with structured logging when tenant has no connected channels", async () => {
    const infoSpy = vi.fn();
    const mockAdapter = new MockWhatsAppAdapter({ info: infoSpy });
    const repo = new InMemoryTenantWhatsAppChannelsRepository([]);
    const router = new WhatsAppGatewayRouter(repo, mockAdapter);

    await router.sendPresence({
      tenantId: tenantA,
      to: "+5511999990000",
      presence: "composing",
    });

    const textResult = await router.sendText({
      tenantId: tenantA,
      to: "+5511999990000",
      text: "Olá! Tudo bem?",
      purpose: "RECEPTION",
    });

    expect(textResult.externalMessageId).toContain("mock_wa_txt_");
    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy.mock.calls[0]?.[0]).toMatchObject({
      action: "sendPresence",
      tenantId: tenantA,
      presence: "composing",
    });
  });

  it("prioritizes CAMPAIGNS_ONLY for CAMPAIGN and RECEPTION_ONLY for RECEPTION, falling back to ALL", async () => {
    const evolutionAdapter: WhatsAppGatewayPort = {
      sendText: vi.fn(async () => ({ externalMessageId: "evo_1" })),
      sendTemplate: vi.fn(async () => ({ externalMessageId: "evo_tpl_1" })),
      sendPresence: vi.fn(async () => undefined),
      getChannelsStatus: vi.fn(async () => []),
    };
    const metaAdapter: WhatsAppGatewayPort = {
      sendText: vi.fn(async () => ({ externalMessageId: "meta_1" })),
      sendTemplate: vi.fn(async () => ({ externalMessageId: "meta_tpl_1" })),
      sendPresence: vi.fn(async () => undefined),
      getChannelsStatus: vi.fn(async () => []),
    };

    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-1",
        tenantId: tenantA,
        provider: "EVOLUTION",
        purpose: "RECEPTION_ONLY",
        phoneNumber: "+5511999991111",
        status: "CONNECTED",
        credentials: { instanceName: "salon_a", apiKey: "evo_secret_9999" },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ch-2",
        tenantId: tenantA,
        provider: "META_OFFICIAL",
        purpose: "CAMPAIGNS_ONLY",
        phoneNumber: "+5511999992222",
        status: "CONNECTED",
        credentials: {
          phoneNumberId: "123456",
          wabaId: "654321",
          accessToken: "EAAG_super_secret_token_8877",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const router = new WhatsAppGatewayRouter(repo, new MockWhatsAppAdapter({ info: vi.fn() }), {
      EVOLUTION: evolutionAdapter,
      META_OFFICIAL: metaAdapter,
    });

    const reception = await router.sendText({
      tenantId: tenantA,
      to: "+5511988887777",
      text: "Oi!",
      purpose: "RECEPTION",
    });
    expect(reception.externalMessageId).toBe("evo_1");

    const campaign = await router.sendTemplate({
      tenantId: tenantA,
      to: "+5511988887777",
      templateName: "promo_vip",
      variables: { name: "Carlos" },
    });
    expect(campaign.externalMessageId).toBe("meta_tpl_1");

    // Tenant B não pode enxergar nem usar canais do Tenant A -> cai no Mock.
    const tenantBResult = await router.sendText({
      tenantId: tenantB,
      to: "+5511988887777",
      text: "Teste isolado",
      purpose: "RECEPTION",
    });
    expect(tenantBResult.externalMessageId).toContain("mock_wa_txt_");
  });

  it("masks sensitive credentials in getChannelsStatus", async () => {
    const repo = new InMemoryTenantWhatsAppChannelsRepository([
      {
        id: "ch-meta",
        tenantId: tenantA,
        provider: "META_OFFICIAL",
        purpose: "ALL",
        phoneNumber: "+5511999993333",
        status: "CONNECTED",
        credentials: {
          phoneNumberId: "998877",
          wabaId: "112233",
          accessToken: "EAAG_secret_value_4321",
        },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const router = new WhatsAppGatewayRouter(repo, new MockWhatsAppAdapter({ info: vi.fn() }));
    const statuses = await router.getChannelsStatus(tenantA);

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.credentials).toEqual({
      phoneNumberId: "998877",
      wabaId: "112233",
      hasAccessToken: true,
      accessTokenMasked: "****4321",
    });
    expect(JSON.stringify(statuses)).not.toContain("EAAG_secret_value_4321");
  });
});
