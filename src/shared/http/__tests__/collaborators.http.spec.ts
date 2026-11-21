import fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CollaboratorEntity } from "../../../modules/Collaborators/domain/entities/collaborator.entity.js";
import type {
  CollaboratorAwardRecord,
  CollaboratorMetricSummary,
  CollaboratorProfileDossier,
  CollaboratorRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../../../modules/Collaborators/domain/repository/collaborators.repository.interface.js";
import { CollaboratorRoutes } from "../../../modules/Collaborators/infra/http/routers/collaborator-routes.js";
import type { PasswordHasher } from "../../cryptography/password-hasher.js";
import { app as mainApp } from "../App.js";
import { resetActorStatusVerifier, setActorStatusVerifier } from "../auth/authenticate.js";
import { registerErrorHandler } from "../error-handler.js";

class FastTestPasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return `hash:${plainText}`;
  }

  async compare(plainText: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `hash:${plainText}`;
  }
}

class InMemoryCollaboratorsHttpRepository implements CollaboratorsRepository {
  readonly companies = new Map<string, { id: string; email: string; isActive: boolean }>();
  readonly collaborators: Array<CollaboratorRecord & { password: string }> = [];

  seedCompany(id: string, email: string, isActive = true): void {
    this.companies.set(id, { id, email: email.trim().toLowerCase(), isActive });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const inCollaborators = this.collaborators.some((c) => c.email === normalized);
    const inCompanies = Array.from(this.companies.values()).some((c) => c.email === normalized);
    return inCollaborators || inCompanies;
  }

  async companyExistsById(companyId: string): Promise<boolean> {
    return this.companies.has(companyId);
  }

  async save(collaborator: CollaboratorEntity): Promise<void> {
    this.collaborators.push({
      id: collaborator.id,
      companyId: collaborator.companyId,
      name: collaborator.name,
      email: collaborator.email,
      password: collaborator.password,
      phone: collaborator.phone,
      whatsapp: collaborator.whatsapp ?? null,
      specialty: collaborator.specialty,
      bio: collaborator.bio ?? null,
      commissionPercentage: collaborator.commissionPercentage,
      defaultCommissionRate: collaborator.defaultCommissionRate,
      monthlyRevenueGoal: collaborator.monthlyRevenueGoal ?? null,
      status: collaborator.status,
      isActive: collaborator.isActive,
      avatarUrl: collaborator.avatarUrl ?? null,
      hiredAt: collaborator.hiredAt,
      deactivatedAt: collaborator.deactivatedAt ?? null,
      deactivationReason: collaborator.deactivationReason ?? null,
      createdAt: collaborator.createdAt,
      updatedAt: collaborator.updatedAt,
    });
  }

  async findById(collaboratorId: string, companyId: string): Promise<CollaboratorEntity | null> {
    const found = this.collaborators.find(
      (c) => c.id === collaboratorId && c.companyId === companyId,
    );
    if (!found) return null;

    return {
      id: found.id,
      companyId: found.companyId,
      name: found.name,
      email: found.email,
      password: found.password,
      phone: found.phone,
      whatsapp: found.whatsapp,
      specialty: found.specialty,
      bio: found.bio,
      commissionPercentage: found.commissionPercentage,
      defaultCommissionRate: found.defaultCommissionRate,
      monthlyRevenueGoal: found.monthlyRevenueGoal,
      status: found.status,
      isActive: found.isActive,
      avatarUrl: found.avatarUrl,
      hiredAt: found.hiredAt,
      deactivatedAt: found.deactivatedAt,
      deactivationReason: found.deactivationReason,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      deactivate: () => {},
      activate: () => {},
      updateProfile: () => {},
      updateCredentials: () => {},
    } as unknown as CollaboratorEntity;
  }

  async findAllByCompanyId(
    companyId: string,
    filters?: { serviceId?: string | undefined; status?: "ACTIVE" | "INACTIVE" | undefined },
  ): Promise<CollaboratorRecord[]> {
    return this.collaborators
      .filter((c) => {
        if (c.companyId !== companyId) return false;
        if (filters?.status && c.status !== filters.status) return false;
        return true;
      })
      .map(({ password: _password, ...record }) => ({ ...record }));
  }

  async update(collaborator: CollaboratorEntity): Promise<void> {
    const index = this.collaborators.findIndex((c) => c.id === collaborator.id);
    if (index !== -1) {
      const existing = this.collaborators[index]!;
      this.collaborators[index] = {
        ...existing,
        name: collaborator.name,
        specialty: collaborator.specialty,
        phone: collaborator.phone,
        updatedAt: new Date(),
      };
    }
  }

  async updateStatusInCompany(
    collaboratorId: string,
    companyId: string,
    isActive: boolean,
  ): Promise<CollaboratorRecord | null> {
    const found = this.collaborators.find(
      (c) => c.id === collaboratorId && c.companyId === companyId,
    );
    if (!found) {
      return null;
    }

    const updated: CollaboratorRecord = {
      ...found,
      isActive,
      status: isActive ? "ACTIVE" : "INACTIVE",
      deactivatedAt: isActive ? null : new Date(),
      updatedAt: new Date(),
    };
    const index = this.collaborators.indexOf(found);
    this.collaborators[index] = { ...updated, password: found.password };
    return updated;
  }

  async listCollaboratorsWithMetrics(
    companyId: string,
  ): Promise<{ teamKpis: TeamKpisSummary; collaborators: CollaboratorMetricSummary[] }> {
    const records = await this.findAllByCompanyId(companyId);
    return {
      teamKpis: {
        totalCollaborators: records.length,
        activeCollaborators: records.filter((r) => r.isActive).length,
        totalCompletedAppointmentsMonth: 0,
        totalRevenueMonthInCents: 0,
        averageTeamRating: 5.0,
      },
      collaborators: records.map((r, i) => ({
        id: r.id,
        companyId: r.companyId,
        name: r.name,
        email: r.email,
        phone: r.phone,
        role: "COLLABORATOR" as const,
        commissionPercentage: r.defaultCommissionRate,
        hiredAt: r.hiredAt,
        avatarUrl: r.avatarUrl ?? null,
        specialty: r.specialty,
        status: r.status,
        isActive: r.isActive,
        defaultCommissionRate: r.defaultCommissionRate,
        completedAppointmentsMonth: 0,
        servicesRevenueMonthInCents: 0,
        productsSalesMonthInCents: 0,
        productsSoldCountMonth: 0,
        revenueMonthInCents: 0,
        commissionMonthInCents: 0,
        averageRating: 5.0,
        totalReviews: 0,
        rankingPosition: i + 1,
        rankingScore: 80,
        awardsCount: 0,
      })),
    };
  }

  async getProfileDossier(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorProfileDossier | null> {
    const found = this.collaborators.find(
      (c) => c.id === collaboratorId && c.companyId === companyId,
    );
    if (!found) return null;

    return {
      collaborator: found,
      tenureFormatted: "1 mês",
      tenureMonths: 1,
      ranking: {
        totalScore: 85,
        position: 1,
        totalInCompany: 1,
        weights: {
          servicesRevenueWeight: 35,
          productsSalesWeight: 25,
          appointmentsVolumeWeight: 15,
          clientReviewsWeight: 15,
          punctualityRetentionWeight: 10,
        },
        pillars: {
          servicesRevenueScore: 35,
          productsSalesScore: 20,
          appointmentsVolumeScore: 15,
          clientReviewsScore: 10,
          punctualityRetentionScore: 5,
        },
      },
      stats: {
        completedAppointmentsMonth: 0,
        totalCompletedAppointments: 0,
        servicesRevenueMonthInCents: 0,
        productsSalesMonthInCents: 0,
        productsSoldCountMonth: 0,
        revenueMonthInCents: 0,
        totalRevenueInCents: 0,
        commissionMonthInCents: 0,
        totalCommissionInCents: 0,
        averageRating: 5,
        totalReviews: 0,
      },
      awards: [],
      recentReviews: [],
      services: [],
      schedules: [],
    };
  }

  async syncServices(): Promise<void> {}
  async syncSchedules(): Promise<void> {}
  async countFutureAppointments(): Promise<number> { return 0; }
  async deactivateAndQueueReschedule(): Promise<{ queuedCount: number }> {
    return { queuedCount: 0 };
  }
}

describe("Collaborators HTTP Layer (POST /collaborators, JWT RBAC, Global Email Uniqueness & OpenAPI)", () => {
  const testSecret = "vitest-collaborators-http-secret";
  const previousSecret = process.env.JWT_SECRET;

  const ownerCompanyId = "11111111-1111-4111-8111-111111111111";
  const otherCompanyId = "22222222-2222-4222-8222-222222222222";
  const collaboratorId = "33333333-3333-4333-8333-333333333333";

  let testApp: FastifyInstance;
  let repository: InMemoryCollaboratorsHttpRepository;

  const signToken = (payload: { sub: string; companyId: string; role: "OWNER" | "COLLABORATOR" }) =>
    jwt.sign(payload, testSecret, { expiresIn: "1h" });

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    await mainApp.ready();
  });

  beforeEach(async () => {
    repository = new InMemoryCollaboratorsHttpRepository();
    repository.seedCompany(ownerCompanyId, "owner@norte.com", true);
    repository.seedCompany(otherCompanyId, "owner@sur.com", true);

    setActorStatusVerifier(async (actor) => {
      const company = repository.companies.get(actor.companyId);
      return company !== undefined && company.isActive;
    });

    testApp = fastify({ logger: false });
    registerErrorHandler(testApp);
    await testApp.register(CollaboratorRoutes, {
      collaboratorsRepository: repository,
      passwordHasher: new FastTestPasswordHasher(),
    });
    await testApp.ready();
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
    await mainApp.close();
  });

  it("rejects unauthenticated requests with 401 and COLLABORATOR tokens with 403", async () => {
    const payload = {
      name: "Pedro Barber",
      email: "pedro@norte.com",
      password: "Secret@123",
      phone: "+584121234567",
      specialty: "Barba",
      commissionPercentage: 45,
    };

    const unauthResponse = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      payload,
    });
    expect(unauthResponse.statusCode).toBe(401);

    const collaboratorToken = signToken({
      sub: collaboratorId,
      companyId: ownerCompanyId,
      role: "COLLABORATOR",
    });

    const forbiddenResponse = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${collaboratorToken}` },
      payload,
    });
    expect(forbiddenResponse.statusCode).toBe(403);

    await testApp.close();
  });

  it("rejects tokens from deactivated OWNER companies with 401", async () => {
    repository.seedCompany(ownerCompanyId, "owner@norte.com", false);

    const ownerToken = signToken({
      sub: ownerCompanyId,
      companyId: ownerCompanyId,
      role: "OWNER",
    });

    const response = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Pedro Barber",
        email: "pedro@norte.com",
        password: "Secret@123",
        phone: "+584121234567",
        specialty: "Barba",
        commissionPercentage: 45,
      },
    });

    expect(response.statusCode).toBe(401);
    await testApp.close();
  });

  it("creates collaborator under authenticated OWNER companyId, ignores injected companyId in body, and enforces global email uniqueness", async () => {
    const ownerToken = signToken({
      sub: ownerCompanyId,
      companyId: ownerCompanyId,
      role: "OWNER",
    });

    const createResponse = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Pedro Barber",
        email: "Pedro@Norte.com",
        password: "Secret@123",
        phone: "+584121234567",
        companyId: otherCompanyId,
        specialty: "Barba",
        commissionPercentage: 45,
      },
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as Record<string, unknown>;
    expect(created.companyId).toBe(ownerCompanyId);
    expect(created.email).toBe("pedro@norte.com");
    expect(created.isActive).toBe(true);
    expect(created.password).toBeUndefined();

    // Duplicado contra outro colaborador existente -> 409
    const duplicateCollabResponse = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Outro Pedro",
        email: "pedro@norte.com",
        password: "Secret@123",
        phone: "+584129999999",
        specialty: "Corte",
        commissionPercentage: 40,
      },
    });
    expect(duplicateCollabResponse.statusCode).toBe(409);

    // Duplicado contra uma empresa existente (mesmo de outro tenant) -> 409
    const duplicateCompanyEmailResponse = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Joao Barber",
        email: "owner@sur.com",
        password: "Secret@123",
        phone: "+584128888888",
        specialty: "Corte",
        commissionPercentage: 40,
      },
    });
    expect(duplicateCompanyEmailResponse.statusCode).toBe(409);

    await testApp.close();
  });

  it("documents POST /collaborators in OpenAPI with bearerAuth and without companyId in body", async () => {
    const response = await mainApp.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json() as {
      paths?: Record<
        string,
        {
          post?: {
            security?: Array<Record<string, unknown>>;
            requestBody?: {
              content?: {
                "application/json"?: {
                  schema?: { properties?: Record<string, unknown>; required?: string[] };
                };
              };
            };
          };
        }
      >;
    };

    const postOp = spec.paths?.["/collaborators"]?.post;
    expect(postOp).toBeDefined();
    expect(postOp?.security).toEqual([{ bearerAuth: [] }]);

    const bodySchema = postOp?.requestBody?.content?.["application/json"]?.schema;
    expect(bodySchema?.properties?.companyId).toBeUndefined();
    expect(bodySchema?.required).not.toContain("companyId");
    expect(spec.paths?.["/collaborators"]).toHaveProperty("get");
    expect(spec.paths?.["/collaborators/{collaboratorId}/status"]).toHaveProperty("patch");

    await testApp.close();
  });

  it("lists company collaborators via GET /collaborators with tenant isolation and updates status via PATCH /collaborators/:collaboratorId/status", async () => {
    const ownerToken = signToken({
      sub: ownerCompanyId,
      companyId: ownerCompanyId,
      role: "OWNER",
    });
    const otherOwnerToken = signToken({
      sub: otherCompanyId,
      companyId: otherCompanyId,
      role: "OWNER",
    });
    const collaboratorToken = signToken({
      sub: collaboratorId,
      companyId: ownerCompanyId,
      role: "COLLABORATOR",
    });

    const createdA = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Pedro Barber",
        email: "pedro@norte.com",
        password: "Secret@123",
        phone: "+584121234567",
        specialty: "Barba",
        commissionPercentage: 45,
      },
    });
    expect(createdA.statusCode).toBe(201);
    const createdABody = createdA.json() as { id: string };

    const createdB = await testApp.inject({
      method: "POST",
      url: "/collaborators",
      headers: { authorization: `Bearer ${otherOwnerToken}` },
      payload: {
        name: "Luis Sur",
        email: "luis@sur.com",
        password: "Secret@123",
        phone: "+584129999999",
        specialty: "Corte",
        commissionPercentage: 50,
      },
    });
    expect(createdB.statusCode).toBe(201);

    // RBAC: COLLABORATOR não pode listar nem alterar status
    const collabList = await testApp.inject({
      method: "GET",
      url: "/collaborators",
      headers: { authorization: `Bearer ${collaboratorToken}` },
    });
    expect(collabList.statusCode).toBe(403);

    const listA = await testApp.inject({
      method: "GET",
      url: "/collaborators",
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(listA.statusCode).toBe(200);
    const listABody = listA.json() as {
      collaborators: Array<Record<string, unknown>>;
    };
    expect(listABody.collaborators).toHaveLength(1);
    expect(listABody.collaborators[0]).toMatchObject({
      id: createdABody.id,
      name: "Pedro Barber",
      specialty: "Barba",
      defaultCommissionRate: 45,
      isActive: true,
      status: "ACTIVE",
    });
    expect(listABody).toHaveProperty("teamKpis");

    // Desativar colaborador da própria empresa -> 200
    const deactivateResponse = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${createdABody.id}/status`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { isActive: false },
    });
    expect(deactivateResponse.statusCode).toBe(200);
    expect((deactivateResponse.json() as { isActive: boolean }).isActive).toBe(false);

    // OWNER tentando desativar a própria conta -> 403
    const selfDeactivate = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${ownerCompanyId}/status`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { isActive: false },
    });
    expect(selfDeactivate.statusCode).toBe(403);

    // Outro OWNER tentando alterar colaborador de outro tenant -> 404
    const crossTenantPatch = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${createdABody.id}/status`,
      headers: { authorization: `Bearer ${otherOwnerToken}` },
      payload: { isActive: true },
    });
    expect(crossTenantPatch.statusCode).toBe(404);

    // Payload inválido -> 400
    const invalidPatch = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${createdABody.id}/status`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { isActive: "yes" },
    });
    expect(invalidPatch.statusCode).toBe(400);

    await testApp.close();
  });
});
