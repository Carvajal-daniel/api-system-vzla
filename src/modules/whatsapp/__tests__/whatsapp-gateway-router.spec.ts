import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyWhatsAppConnection } from "../domain/entities/company-whatsapp-connection.entity.js";
import { CampaignChannelNotConfiguredError } from "../domain/errors/whatsapp-errors.js";
import type { CompanyWhatsAppConnectionRepository } from "../domain/repositories/company-whatsapp-connection.repository.js";
import { AesSecretCipher } from "../infra/crypto/aes-secret-cipher.js";
import { DatafyWhatsAppAdapter } from "../infra/whatsapp/datafy-whatsapp.adapter.js";
import { EvolutionWhatsAppAdapter } from "../infra/whatsapp/evolution-whatsapp.adapter.js";
import { WhatsAppGatewayRouter } from "../infra/whatsapp/whatsapp-gateway-router.js";

class InMemoryWhatsAppConnectionRepository
  implements CompanyWhatsAppConnectionRepository
{
  private readonly store = new Map<string, CompanyWhatsAppConnection>();

  async findByCompanyId(
    companyId: string,
  ): Promise<CompanyWhatsAppConnection | null> {
    return this.store.get(companyId) ?? null;
  }

  async findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<CompanyWhatsAppConnection | null> {
    for (const connection of this.store.values()) {
      if (connection.evolutionInstanceName === instanceName) {
        return connection;
      }
    }
    return null;
  }

  async upsert(
    connection: CompanyWhatsAppConnection,
  ): Promise<CompanyWhatsAppConnection> {
    this.store.set(connection.companyId, connection);
    return connection;
  }
}

describe("WhatsAppGatewayRouter & Adapters", () => {
  const companyId = "26e23a0f-9b29-4f4f-a438-cf235ba2aa29";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "test-secret-for-whatsapp-cipher");
    vi.stubEnv("WHATSAPP_EVOLUTION_URL", "");
    vi.stubEnv("WHATSAPP_EVOLUTION_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("operates EvolutionWhatsAppAdapter in MOCK_READY mode when env vars are missing in dev/test", async () => {
    const adapter = new EvolutionWhatsAppAdapter();
    expect(adapter.getMode()).toBe("MOCK_READY");

    const qr = await adapter.connectAndGetQrCode(companyId);
    expect(qr.mode).toBe("MOCK_READY");
    expect(qr.instanceName).toBe(`cloudgo_${companyId}`);
    expect(qr.status).toBe("QRCODE_PENDING");
    expect(qr.qrCodeBase64).toContain("data:image/svg+xml;base64,");
  });

  it("routes CONVERSATIONAL_REPLY to Evolution (MOCK_READY in dev)", async () => {
    const repo = new InMemoryWhatsAppConnectionRepository();
    const router = new WhatsAppGatewayRouter(
      repo,
      new EvolutionWhatsAppAdapter(),
      new DatafyWhatsAppAdapter(),
      new AesSecretCipher(),
    );

    const result = await router.send({
      purpose: "CONVERSATIONAL_REPLY",
      companyId,
      phone: "+5511999998888",
      text: "Olá! Seu horário está confirmado.",
    });

    expect(result.purpose).toBe("CONVERSATIONAL_REPLY");
    expect(result.provider).toBe("MOCK_READY");
    expect(result.referenceId).toContain("mock_");
  });

  it("throws CAMPAIGN_CHANNEL_NOT_CONFIGURED when CAMPAIGN_BLAST is requested without active Datafy", async () => {
    const repo = new InMemoryWhatsAppConnectionRepository();
    const router = new WhatsAppGatewayRouter(
      repo,
      new EvolutionWhatsAppAdapter(),
      new DatafyWhatsAppAdapter(),
      new AesSecretCipher(),
    );

    await expect(
      router.send({
        purpose: "CAMPAIGN_BLAST",
        companyId,
        recipients: ["+5511999998888"],
        bodyText: "Promoção da semana!",
      }),
    ).rejects.toMatchObject({
      reasonCode: "CAMPAIGN_CHANNEL_NOT_CONFIGURED",
    });

    await expect(
      router.send({
        purpose: "CAMPAIGN_BLAST",
        companyId,
        recipients: ["+5511999998888"],
        bodyText: "Promoção da semana!",
      }),
    ).rejects.toBeInstanceOf(CampaignChannelNotConfiguredError);
  });

  it("routes CAMPAIGN_BLAST to Datafy when configured and decrypts token cleanly", async () => {
    const repo = new InMemoryWhatsAppConnectionRepository();
    const cipher = new AesSecretCipher();
    const encryptedToken = cipher.encrypt("dfy_live_token_123456789");

    await repo.upsert(
      CompanyWhatsAppConnection.createDefault(companyId).withDatafyConfig({
        enabled: true,
        instanceId: "dfy_inst_01",
        apiTokenEncrypted: encryptedToken,
        status: "CONNECTED",
      }),
    );

    const router = new WhatsAppGatewayRouter(
      repo,
      new EvolutionWhatsAppAdapter(),
      new DatafyWhatsAppAdapter(),
      cipher,
    );

    const result = await router.send({
      purpose: "CAMPAIGN_BLAST",
      companyId,
      recipients: ["+5511999998888", "+5511988887777"],
      bodyText: "Volte esta semana com 15% OFF!",
    });

    expect(result.purpose).toBe("CAMPAIGN_BLAST");
    expect(result.provider).toBe("DATAFY");
    expect(result.referenceId).toContain("datafy_stub_");
  });
});
