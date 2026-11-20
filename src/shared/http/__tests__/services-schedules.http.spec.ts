import fastify from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryCollaboratorLookupRepository } from "../../../modules/services/application/__tests__/in-memory-collaborator-lookup.repository.js";
import { InMemoryCollaboratorServicesRepository } from "../../../modules/services/application/__tests__/in-memory-collaborator-services.repository.js";
import { InMemoryCompanyLookupRepository } from "../../../modules/services/application/__tests__/in-memory-company-lookup.repository.js";
import { InMemoryServicesRepository } from "../../../modules/services/application/__tests__/in-memory-services.repository.js";
import { CollaboratorServiceEntity } from "../../../modules/services/domain/entities/collaborator-service.entity.js";
import { ServiceEntity } from "../../../modules/services/domain/entities/service.entity.js";
import { servicesRoutes } from "../../../modules/services/infra/http/routes/services.routes.js";
import { app } from "../App.js";
import { resetActorStatusVerifier, setActorStatusVerifier } from "../auth/authenticate.js";
import { registerErrorHandler } from "../error-handler.js";

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
    expect(spec.paths?.["/services/{serviceId}/collaborators"]).toHaveProperty("get");
    expect(spec.paths).toHaveProperty("/services/{serviceId}/collaborators/{collaboratorId}");
    expect(spec.paths).toHaveProperty("/collaborators/{collaboratorId}/work-schedules");
    expect(spec.paths).toHaveProperty("/me/services");
    expect(spec.paths).toHaveProperty("/me/work-schedules");
    expect(spec.paths).toHaveProperty("/public/companies/{companyId}/services");
  });

  it("handles CORS preflight and allows configured local frontend origin while blocking unknown origins", async () => {
    const preflightAllowed = await app.inject({
      method: "OPTIONS",
      url: "/services",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(preflightAllowed.statusCode).toBe(204);
    expect(preflightAllowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const blockedOrigin = await app.inject({
      method: "GET",
      url: "/docs/json",
      headers: {
        origin: "https://evil.example.com",
      },
    });
    expect(blockedOrigin.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves GET /services/:serviceId/collaborators and GET /public/companies/:companyId/services with tenant isolation and 404 on inactive/missing company", async () => {
    const otherCompanyId = "22222222-2222-4222-8222-222222222222";
    const inactiveCompanyId = "33333333-3333-4333-8333-333333333333";
    const unknownCompanyId = "99999999-9999-4999-8999-999999999999";

    const servicesRepo = new InMemoryServicesRepository();
    const linksRepo = new InMemoryCollaboratorServicesRepository();
    const collaboratorLookupRepo = new InMemoryCollaboratorLookupRepository();
    const companyLookupRepo = new InMemoryCompanyLookupRepository();

    companyLookupRepo.seed({
      id: companyId,
      companyName: "Barbearia Norte",
      timezone: "America/Sao_Paulo",
      isActive: true,
    });
    companyLookupRepo.seed({
      id: inactiveCompanyId,
      companyName: "Barbearia Inativa",
      timezone: "America/Sao_Paulo",
      isActive: false,
    });

    const service = ServiceEntity.create({
      companyId,
      name: "Corte Clásico",
      durationMinutes: 45,
      priceInCents: 3500,
    });
    await servicesRepo.create(service);

    collaboratorLookupRepo.items.push({
      id: collaboratorId,
      companyId,
      name: "Carlos Barbero",
      specialty: "Barba",
      isActive: true,
    });

    await linksRepo.create(
      CollaboratorServiceEntity.create({
        companyId,
        collaboratorId,
        serviceId: service.id,
        commissionPercentage: 45,
      }),
    );

    const isolatedApp = fastify({ logger: false });
    registerErrorHandler(isolatedApp);
    await isolatedApp.register(servicesRoutes, {
      servicesRepository: servicesRepo,
      collaboratorServicesRepository: linksRepo,
      collaboratorLookupRepository: collaboratorLookupRepo,
      companyLookupRepository: companyLookupRepo,
    });
    await isolatedApp.ready();

    const otherOwnerToken = jwt.sign(
      { sub: otherCompanyId, companyId: otherCompanyId, role: "OWNER" },
      testSecret,
    );

    const ownerListLinks = await isolatedApp.inject({
      method: "GET",
      url: `/services/${service.id}/collaborators`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(ownerListLinks.statusCode).toBe(200);
    expect(ownerListLinks.json()).toEqual({
      collaborators: [
        {
          collaboratorId,
          name: "Carlos Barbero",
          specialty: "Barba",
          isActive: true,
          commissionPercentage: 45,
        },
      ],
    });

    const crossTenantLinks = await isolatedApp.inject({
      method: "GET",
      url: `/services/${service.id}/collaborators`,
      headers: { authorization: `Bearer ${otherOwnerToken}` },
    });
    expect(crossTenantLinks.statusCode).toBe(404);

    const collabForbiddenLinks = await isolatedApp.inject({
      method: "GET",
      url: `/services/${service.id}/collaborators`,
      headers: { authorization: `Bearer ${collaboratorToken}` },
    });
    expect(collabForbiddenLinks.statusCode).toBe(403);

    const publicCatalogOk = await isolatedApp.inject({
      method: "GET",
      url: `/public/companies/${companyId}/services`,
    });
    expect(publicCatalogOk.statusCode).toBe(200);
    expect(publicCatalogOk.json()).toEqual({
      company: {
        id: companyId,
        companyName: "Barbearia Norte",
        timezone: "America/Sao_Paulo",
      },
      services: [
        {
          id: service.id,
          name: "Corte Clásico",
          description: null,
          durationMinutes: 45,
          priceInCents: 3500,
          collaborators: [
            {
              id: collaboratorId,
              name: "Carlos Barbero",
              specialty: "Barba",
            },
          ],
        },
      ],
    });

    const publicInactive = await isolatedApp.inject({
      method: "GET",
      url: `/public/companies/${inactiveCompanyId}/services`,
    });
    expect(publicInactive.statusCode).toBe(404);

    const publicUnknown = await isolatedApp.inject({
      method: "GET",
      url: `/public/companies/${unknownCompanyId}/services`,
    });
    expect(publicUnknown.statusCode).toBe(404);

    await isolatedApp.close();
  });
});
