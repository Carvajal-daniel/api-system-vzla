import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJwtSecret } from "../../../../../shared/config/env.js";
import {
  resetActorStatusVerifier,
  setActorStatusVerifier,
} from "../../../../../shared/http/auth/authenticate.js";
import { DrizzleTenantUsageRepository } from "../../database/repositories/drizzle-tenant-usage.repository.js";
import { billingRoutes } from "../billing.routes.js";

describe("GET /v1/billing/usage (HTTP + Auth + OpenAPI)", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";
  const userId = "99999999-9999-4999-8999-999999999999";

  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-billing-jwt-secret");
    setActorStatusVerifier(async () => true);
  });

  afterEach(() => {
    resetActorStatusVerifier();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const app = fastify();
    await app.register(billingRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/v1/billing/usage",
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns usage summary scoped strictly to the authenticated tenant and exposes OpenAPI spec", async () => {
    const planSpy = vi
      .spyOn(DrizzleTenantUsageRepository.prototype, "getTenantPlanTier")
      .mockResolvedValue("TRIAL");
    const usageSpy = vi
      .spyOn(DrizzleTenantUsageRepository.prototype, "getMonthlyUsage")
      .mockResolvedValue({
        tenantId,
        periodMonth: "2026-11",
        aiSessionsCount: 5,
        outboundMessagesCount: 60,
        totalInputTokens: 1200,
        totalOutputTokens: 400,
        updatedAt: new Date("2026-11-25T12:00:00.000Z"),
      });

    const app = fastify();
    await app.register(fastifySwagger, {
      openapi: {
        openapi: "3.1.0",
        info: { title: "Billing Test API", version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
      },
    });
    await app.register(billingRoutes);
    await app.ready();

    const token = jwt.sign(
      { sub: userId, companyId: tenantId, role: "OWNER" },
      getJwtSecret(),
    );

    // Mesmo que o chamador tente injetar outro tenantId na query, o endpoint ignora e usa apenas o JWT.
    const response = await app.inject({
      method: "GET",
      url: "/v1/billing/usage?tenantId=22222222-2222-4222-8222-222222222222",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(planSpy).toHaveBeenCalledWith(tenantId);
    expect(usageSpy).toHaveBeenCalledWith(tenantId, expect.stringMatching(/^\d{4}-\d{2}$/));

    const body = response.json();
    expect(body).toMatchObject({
      planName: "Trial",
      aiSessions: { used: 5, limit: 20, percentage: 25 },
      outboundMessages: { used: 60, limit: 300, percentage: 20 },
      isBlocked: false,
    });

    const spec = app.swagger();
    expect(spec.paths?.["/v1/billing/usage"]).toBeDefined();

    await app.close();
  });
});
