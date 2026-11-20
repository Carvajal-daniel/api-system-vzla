import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../App.js";
import { resetActorStatusVerifier, setActorStatusVerifier } from "../auth/authenticate.js";

describe("Services & Work Schedules HTTP Layer (JWT, RBAC, Zod, OpenAPI)", () => {
  const testSecret = "vitest-http-integration-secret";
  const previousSecret = process.env.JWT_SECRET;

  const companyId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const collaboratorId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const serviceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  let ownerToken: string;
  let collaboratorToken: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    setActorStatusVerifier(async () => true);
    await app.ready();

    ownerToken = jwt.sign({ sub: ownerId, companyId, role: "OWNER" }, testSecret);
    collaboratorToken = jwt.sign(
      { sub: collaboratorId, companyId, role: "COLLABORATOR" },
      testSecret,
    );
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
    await app.close();
  });

  it("returns 401 when protected routes are called without a valid JWT", async () => {
    const missingAuth = await app.inject({
      method: "POST",
      url: "/services",
      payload: { name: "Corte", durationMinutes: 30, priceInCents: 2500 },
    });
    expect(missingAuth.statusCode).toBe(401);

    const invalidToken = await app.inject({
      method: "GET",
      url: "/me/services",
      headers: { authorization: "Bearer invalid.jwt.token" },
    });
    expect(invalidToken.statusCode).toBe(401);

    const badClaimsToken = jwt.sign({ sub: "not-a-uuid", companyId, role: "OWNER" }, testSecret);
    const invalidClaims = await app.inject({
      method: "GET",
      url: "/services",
      headers: { authorization: `Bearer ${badClaimsToken}` },
    });
    expect(invalidClaims.statusCode).toBe(401);
  });

  it("enforces RBAC with 403 for COLLABORATOR on OWNER routes and OWNER on /me/* routes", async () => {
    const collabCreateService = await app.inject({
      method: "POST",
      url: "/services",
      headers: { authorization: `Bearer ${collaboratorToken}` },
      payload: { name: "Corte", durationMinutes: 30, priceInCents: 2500 },
    });
    expect(collabCreateService.statusCode).toBe(403);

    const collabUpsertSchedule = await app.inject({
      method: "PUT",
      url: `/collaborators/${collaboratorId}/work-schedules`,
      headers: { authorization: `Bearer ${collaboratorToken}` },
      payload: { schedules: [{ dayOfWeek: 1, isWorkingDay: false }] },
    });
    expect(collabUpsertSchedule.statusCode).toBe(403);

    const ownerMeServices = await app.inject({
      method: "GET",
      url: "/me/services",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerMeServices.statusCode).toBe(403);

    const ownerMeSchedules = await app.inject({
      method: "GET",
      url: "/me/work-schedules",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerMeSchedules.statusCode).toBe(403);
  });

  it("rejects invalid payloads and params with 400 via Zod before touching persistence", async () => {
    const invalidService = await app.inject({
      method: "POST",
      url: "/services",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: "Corte", durationMinutes: 0, priceInCents: -10 },
    });
    expect(invalidService.statusCode).toBe(400);

    const invalidCommission = await app.inject({
      method: "POST",
      url: `/services/${serviceId}/collaborators`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { collaboratorId, commissionPercentage: 150 },
    });
    expect(invalidCommission.statusCode).toBe(400);

    const invalidSchedule = await app.inject({
      method: "PUT",
      url: `/collaborators/${collaboratorId}/work-schedules`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { schedules: [{ dayOfWeek: 9, isWorkingDay: false }] },
    });
    expect(invalidSchedule.statusCode).toBe(400);

    const invalidPublicCompanyId = await app.inject({
      method: "GET",
      url: "/public/companies/not-a-uuid/services",
    });
    expect(invalidPublicCompanyId.statusCode).toBe(400);
  });

  it("generates a valid OpenAPI 3.1 document including all Stage 1 endpoints in non-production", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths).toHaveProperty("/services");
    expect(spec.paths).toHaveProperty("/services/{serviceId}");
    expect(spec.paths).toHaveProperty("/services/{serviceId}/status");
    expect(spec.paths).toHaveProperty("/services/{serviceId}/collaborators");
    expect(spec.paths).toHaveProperty("/services/{serviceId}/collaborators/{collaboratorId}");
    expect(spec.paths).toHaveProperty("/collaborators/{collaboratorId}/work-schedules");
    expect(spec.paths).toHaveProperty("/me/services");
    expect(spec.paths).toHaveProperty("/me/work-schedules");
    expect(spec.paths).toHaveProperty("/public/companies/{companyId}/services");
  });
});
