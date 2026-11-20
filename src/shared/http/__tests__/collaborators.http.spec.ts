import fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CollaboratorEntity } from "../../../modules/Collaborators/domain/entities/collaborator.entity.js";
import type { CollaboratorsRepository } from "../../../modules/Collaborators/domain/repository/collaborators.repository.interface.js";
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
  readonly collaborators: CollaboratorEntity[] = [];

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
    this.collaborators.push(collaborator);
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

    await testApp.close();
  });
});
