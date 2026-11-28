import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getJwtSecret } from "../../../shared/config/env.js";
import { db } from "../../../shared/database/database.js";
import { registerErrorHandler } from "../../../shared/http/error-handler.js";
import { resetActorStatusVerifier, setActorStatusVerifier } from "../../../shared/http/auth/authenticate.js";
import { CompanyTable } from "../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../Company/infra/database/schema/company-settings-schema.js";
import { CompanyPaymentConfigTable } from "../infra/database/schema/payments-schema.js";
import { PaymentsRepository } from "../infra/database/payments.repository.js";
import { paymentRoutes } from "../infra/http/payment.routes.js";
import { MercadoPagoPaymentAdapter } from "../infra/gateways/mercado-pago-payment.adapter.js";

const TEST_ENCRYPTION_KEY = "test-payment-encryption-key-at-least-32-chars!";

describe("Frictionless owner payments onboarding", () => {
  let companyId: string;
  let ownerToken: string;

  beforeAll(async () => {
    setActorStatusVerifier(async () => true);
    companyId = randomUUID();
    const slug = `frictionless-${companyId.slice(0, 8)}`;
    await db.insert(CompanyTable).values({
      id: companyId,
      companyName: "Barbearia Sem Fricção",
      slug,
      name: "Dono Teste",
      phone: "+5511999998888",
      email: `${slug}@example.test`,
      password: "hashed-password",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
    });

    ownerToken = jwt.sign(
      { sub: companyId, companyId, role: "OWNER" },
      getJwtSecret(),
      { expiresIn: "1h" },
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await db.delete(CompanyPaymentConfigTable).where(eq(CompanyPaymentConfigTable.companyId, companyId));
    await db.delete(CompanySettingsTable).where(eq(CompanySettingsTable.companyId, companyId));
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    await db.delete(CompanyTable).where(eq(CompanyTable.id, companyId));
  });

  async function buildApp(transport?: typeof fetch) {
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(paymentRoutes, {
      repository: new PaymentsRepository(transport),
    });
    await app.ready();
    return app;
  }

  it("returns 503 OAUTH_PROVIDER_NOT_CONFIGURED when Mercado Pago OAuth env vars are missing", async () => {
    vi.stubEnv("MERCADO_PAGO_CLIENT_ID", "");
    vi.stubEnv("MERCADO_PAGO_CLIENT_SECRET", "");

    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/payments/oauth/mercadopago/authorize",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: "OAUTH_PROVIDER_NOT_CONFIGURED" });
    await app.close();
  });

  it("generates a signed 15-min Mercado Pago OAuth URL, rejects tampered state, and completes callback", async () => {
    vi.stubEnv("PAYMENT_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    vi.stubEnv("MERCADO_PAGO_CLIENT_ID", "mp-client-123");
    vi.stubEnv("MERCADO_PAGO_CLIENT_SECRET", "mp-secret-456");
    vi.stubEnv("FRONTEND_URL", "https://app.barbearia.test");
    vi.stubEnv("API_PUBLIC_URL", "https://api.barbearia.test");

    const mockTransport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "APP_USR-super-secret-access-token",
        refresh_token: "TG-super-secret-refresh-token",
        public_key: "APP_USR-public-key-789",
        user_id: 987654321,
        expires_in: 21600,
      }),
    );

    const app = await buildApp(mockTransport);

    // 1. Gera URL de autorização
    const authRes = await app.inject({
      method: "GET",
      url: "/payments/oauth/mercadopago/authorize",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(authRes.statusCode).toBe(200);
    const { authorizationUrl } = authRes.json() as { authorizationUrl: string };
    const parsedUrl = new URL(authorizationUrl);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe("https://auth.mercadopago.com.br/authorization");
    expect(parsedUrl.searchParams.get("client_id")).toBe("mp-client-123");
    expect(parsedUrl.searchParams.get("response_type")).toBe("code");
    expect(parsedUrl.searchParams.get("platform_id")).toBe("mp");
    expect(parsedUrl.searchParams.get("redirect_uri")).toBe("https://api.barbearia.test/payments/oauth/mercadopago/callback");
    const state = parsedUrl.searchParams.get("state");
    expect(state).toBeTruthy();

    // 2. Callback com state adulterado redireciona com erro
    const invalidCallback = await app.inject({
      method: "GET",
      url: "/payments/oauth/mercadopago/callback?code=TG-code&state=invalid-state-token",
    });
    expect(invalidCallback.statusCode).toBe(302);
    expect(invalidCallback.headers.location).toBe(
      "https://app.barbearia.test/owner/settings?tab=payments&oauth=error&reason=OAUTH_INVALID_STATE",
    );

    // 3. Callback válido troca code por tokens, salva no tenant e redireciona com sucesso
    const validCallback = await app.inject({
      method: "GET",
      url: `/payments/oauth/mercadopago/callback?code=TG-valid-code&state=${encodeURIComponent(state!)}`,
    });
    expect(validCallback.statusCode).toBe(302);
    expect(validCallback.headers.location).toBe(
      "https://app.barbearia.test/owner/settings?tab=payments&oauth=success",
    );
    expect(mockTransport).toHaveBeenCalledTimes(1);

    // 4. GET /payments/connection-status retorna status conectado sem vazar nenhum segredo
    const statusRes = await app.inject({
      method: "GET",
      url: "/payments/connection-status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    const rawStatus = statusRes.body;
    expect(rawStatus).not.toContain("APP_USR-super-secret-access-token");
    expect(rawStatus).not.toContain("TG-super-secret-refresh-token");
    expect(statusRes.json()).toEqual({
      provider: "MERCADO_PAGO",
      connected: true,
      accountLabel: "Mercado Pago #987654321",
      walletId: null,
      mpUserId: "987654321",
      depositEnabled: true,
      depositPercentage: 30,
      autoRefundHours: 24,
      capabilities: {
        mercadoPagoOAuthAvailable: true,
        asaasExpressAvailable: false,
      },
    });

    // 5. Disconnect limpa credenciais e desativa provedor
    const disconnectRes = await app.inject({
      method: "POST",
      url: "/payments/oauth/mercadopago/disconnect",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(disconnectRes.statusCode).toBe(200);
    expect(disconnectRes.json()).toEqual({ disconnected: true, provider: "NONE" });

    const afterDisconnect = await app.inject({
      method: "GET",
      url: "/payments/connection-status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(afterDisconnect.json()).toMatchObject({
      provider: "NONE",
      connected: false,
      mpUserId: null,
    });

    await app.close();
  });

  it("refreshes Mercado Pago OAuth tokens via adapter helper", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        access_token: "APP_USR-new-access-token",
        refresh_token: "TG-new-refresh-token",
        public_key: "APP_USR-pub",
        user_id: "555111",
        expires_in: 21600,
      }),
    );

    const adapter = new MercadoPagoPaymentAdapter("old-token", transport);
    const refreshed = await adapter.refreshAccessToken({
      clientId: "mp-client",
      clientSecret: "mp-secret",
      refreshToken: "TG-old-refresh-token",
    });

    expect(refreshed).toEqual({
      accessToken: "APP_USR-new-access-token",
      refreshToken: "TG-new-refresh-token",
      publicKey: "APP_USR-pub",
      userId: "555111",
      expiresIn: 21600,
    });
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.mercadopago.com/oauth/token");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "TG-old-refresh-token",
    });
  });

  it("creates an express Asaas subaccount with mocked HTTP and never exposes apiKey", async () => {
    vi.stubEnv("PAYMENT_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    vi.stubEnv("ASAAS_MASTER_API_KEY", "");

    const appWithoutMaster = await buildApp();
    const unavailable = await appWithoutMaster.inject({
      method: "POST",
      url: "/payments/onboarding/asaas/subaccount",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Barbearia Express",
        email: "financeiro@barbearia.test",
        cpfCnpj: "12.345.678/0001-90",
        mobilePhone: "(11) 99999-8888",
        incomeValue: 15000,
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({ code: "ASAAS_MASTER_NOT_CONFIGURED" });
    await appWithoutMaster.close();

    vi.stubEnv("ASAAS_MASTER_API_KEY", "$aact_master_platform_secret");
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");

    const mockTransport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        id: "acc_sub_001",
        apiKey: "$aact_subaccount_ultra_secret_key",
        walletId: "wallet_sub_999",
        email: "financeiro@barbearia.test",
        name: "Barbearia Express",
      }),
    );

    const app = await buildApp(mockTransport);
    const createdRes = await app.inject({
      method: "POST",
      url: "/payments/onboarding/asaas/subaccount",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Barbearia Express",
        email: "financeiro@barbearia.test",
        cpfCnpj: "12.345.678/0001-90",
        mobilePhone: "(11) 99999-8888",
        incomeValue: 15000,
        address: "Rua Augusta",
        addressNumber: "100",
        postalCode: "01305-000",
      },
    });

    expect(createdRes.statusCode).toBe(201);
    expect(createdRes.body).not.toContain("$aact_subaccount_ultra_secret_key");
    expect(createdRes.body).not.toContain("$aact_master_platform_secret");
    expect(createdRes.json()).toEqual({
      provider: "ASAAS",
      connected: true,
      accountLabel: "financeiro@barbearia.test",
      walletId: "wallet_sub_999",
    });

    const [calledUrl, calledInit] = mockTransport.mock.calls[0]!;
    expect(calledUrl).toBe("https://api-sandbox.asaas.com/v3/accounts");
    expect(calledInit?.headers).toMatchObject({ access_token: "$aact_master_platform_secret" });
    expect(JSON.parse(String(calledInit?.body))).toMatchObject({
      name: "Barbearia Express",
      email: "financeiro@barbearia.test",
      cpfCnpj: "12345678000190",
      mobilePhone: "11999998888",
      incomeValue: 15000,
      postalCode: "01305000",
    });

    const statusRes = await app.inject({
      method: "GET",
      url: "/payments/connection-status",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.body).not.toContain("$aact_subaccount_ultra_secret_key");
    expect(statusRes.json()).toMatchObject({
      provider: "ASAAS",
      connected: true,
      accountLabel: "financeiro@barbearia.test",
      walletId: "wallet_sub_999",
      mpUserId: null,
      depositEnabled: true,
      capabilities: {
        asaasExpressAvailable: true,
      },
    });

    await app.close();
  });

  it("connects an existing Asaas account using only apiKey, validates via /v3/myAccount, and auto-registers webhook on public URL", async () => {
    vi.stubEnv("PAYMENT_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    vi.stubEnv("API_PUBLIC_URL", "https://api.barbearia.test");

    const mockTransport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          id: "acc_existing_01",
          walletId: "wallet_existing_123",
          tradingName: "Barbearia Dom Pedro",
          email: "contato@dompedro.test",
        }),
      )
      .mockResolvedValueOnce(Response.json({ id: "wh_001", enabled: true }));

    const app = await buildApp(mockTransport);
    const res = await app.inject({
      method: "POST",
      url: "/payments/onboarding/asaas/connect-existing",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        apiKey: "$aact_prod_existing_secret_key_123456",
        staticPixKey: "contato@dompedro.test",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("$aact_prod_existing_secret_key_123456");
    expect(res.json()).toEqual({
      provider: "ASAAS",
      connected: true,
      accountLabel: "Barbearia Dom Pedro",
      walletId: "wallet_existing_123",
    });

    // 1a chamada: GET /v3/myAccount em produção (detectado pelo prefixo $aact_prod_)
    expect(mockTransport).toHaveBeenCalledTimes(2);
    expect(mockTransport.mock.calls[0]?.[0]).toBe("https://api.asaas.com/v3/myAccount");
    expect(mockTransport.mock.calls[0]?.[1]?.method).toBe("GET");

    // 2a chamada: POST /v3/webhooks com URL pública e authToken gerado no servidor
    expect(mockTransport.mock.calls[1]?.[0]).toBe("https://api.asaas.com/v3/webhooks");
    expect(mockTransport.mock.calls[1]?.[1]?.method).toBe("POST");
    const webhookBody = JSON.parse(String(mockTransport.mock.calls[1]?.[1]?.body));
    expect(webhookBody).toMatchObject({
      url: "https://api.barbearia.test/payments/webhooks/asaas",
      enabled: true,
    });
    expect(typeof webhookBody.authToken).toBe("string");
    expect(webhookBody.authToken.length).toBeGreaterThanOrEqual(32);

    await app.close();
  });

  it("returns 422 when connecting an invalid Asaas apiKey and skips webhook registration on localhost", async () => {
    vi.stubEnv("PAYMENT_ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);
    vi.stubEnv("API_PUBLIC_URL", "http://localhost:3333");

    const invalidTransport = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ errors: [{ description: "Chave de API inválida" }] }, { status: 401 }),
    );
    const appInvalid = await buildApp(invalidTransport);
    const invalidRes = await appInvalid.inject({
      method: "POST",
      url: "/payments/onboarding/asaas/connect-existing",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { apiKey: "$aact_hmlg_invalid_key_123456" },
    });
    expect(invalidRes.statusCode).toBe(422);
    expect(invalidRes.json()).toMatchObject({ code: "ASAAS_INVALID_API_KEY" });
    expect(invalidTransport.mock.calls[0]?.[0]).toBe("https://api-sandbox.asaas.com/v3/myAccount");
    await appInvalid.close();

    const localhostTransport = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({ id: "acc_local", walletId: "wallet_local", name: "Sandbox Local" }),
    );
    const appLocal = await buildApp(localhostTransport);
    const okRes = await appLocal.inject({
      method: "POST",
      url: "/payments/onboarding/asaas/connect-existing",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { apiKey: "$aact_hmlg_valid_local_key_123456" },
    });
    expect(okRes.statusCode).toBe(200);
    // Apenas GET /v3/myAccount; POST /v3/webhooks é ignorado silenciosamente em localhost.
    expect(localhostTransport).toHaveBeenCalledTimes(1);
    await appLocal.close();
  });
});
