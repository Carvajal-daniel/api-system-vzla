import fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAuthIdentityRepository } from "../../../modules/auth/application/__tests__/in-memory-auth-identity.repository.js";
import { JwtTokenService } from "../../../modules/auth/infra/cryptography/jwt-token-service.js";
import { authRoutes } from "../../../modules/auth/infra/http/routes/auth.routes.js";
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

describe("Auth HTTP Layer (/auth/register, /auth/login, /me, Deactivation & OpenAPI)", () => {
  const testSecret = "vitest-auth-http-secret";
  const previousSecret = process.env.JWT_SECRET;
  const previousExpiresIn = process.env.JWT_EXPIRES_IN;

  let testApp: FastifyInstance;
  let repository: InMemoryAuthIdentityRepository;

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    process.env.JWT_EXPIRES_IN = "1d";
    await mainApp.ready();
  });

  beforeEach(async () => {
    repository = new InMemoryAuthIdentityRepository();

    setActorStatusVerifier(async (actor) => {
      if (actor.role === "OWNER") {
        const owner = await repository.findOwnerById(actor.companyId);
        return owner !== null && owner.isActive;
      }

      const collaborator = await repository.findCollaboratorById(
        actor.collaboratorId,
        actor.companyId,
      );
      return collaborator !== null && collaborator.isActive && collaborator.companyIsActive;
    });

    testApp = fastify({ logger: false });
    registerErrorHandler(testApp);
    await testApp.register(authRoutes, {
      authIdentityRepository: repository,
      passwordHasher: new FastTestPasswordHasher(),
      tokenService: new JwtTokenService(),
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
    if (previousExpiresIn === undefined) {
      delete process.env.JWT_EXPIRES_IN;
    } else {
      process.env.JWT_EXPIRES_IN = previousExpiresIn;
    }
    await mainApp.close();
  });

  it("registers an owner, returns a valid JWT, and resolves GET /me", async () => {
    const registerResponse = await testApp.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        companyName: "Barberia Norte",
        name: "Daniel Perez",
        phone: "+584121234567",
        email: "Owner@Norte.com",
        password: "Secret@123",
        timezone: "America/Caracas",
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    const registerBody = registerResponse.json() as {
      accessToken: string;
      tokenType: string;
      expiresIn: string;
      user: { id: string; companyId: string; role: string; email: string };
    };
    expect(registerBody.tokenType).toBe("Bearer");
    expect(registerBody.expiresIn).toBe("1d");
    expect(registerBody.user.role).toBe("OWNER");
    expect(registerBody.user.email).toBe("owner@norte.com");

    const meResponse = await testApp.inject({
      method: "GET",
      url: "/me",
      headers: {
        authorization: `Bearer ${registerBody.accessToken}`,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    const meBody = meResponse.json() as {
      role: string;
      email: string;
      company: { companyName: string; timezone: string; isActive: boolean };
    };
    expect(meBody.role).toBe("OWNER");
    expect(meBody.email).toBe("owner@norte.com");
    expect(meBody.company.companyName).toBe("Barberia Norte");
    expect(meBody.company.timezone).toBe("America/Caracas");
    expect(meBody.company.isActive).toBe(true);

    const duplicateResponse = await testApp.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        companyName: "Otra Barberia",
        name: "Otro Dueno",
        phone: "+584129999999",
        email: "owner@norte.com",
        password: "Secret@123",
      },
    });
    expect(duplicateResponse.statusCode).toBe(409);

    await testApp.close();
  });

  it("logs in owner and collaborator, blocks inactive accounts, and revokes active tokens on deactivation", async () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    const collaboratorId = "22222222-2222-4222-8222-222222222222";

    repository.seedCompany({
      id: companyId,
      companyName: "Salon Sur",
      name: "Maria Owner",
      phone: "+584121111111",
      email: "owner@sur.com",
      passwordHash: "hash:Owner@123",
      isActive: true,
    });

    repository.seedCollaborator({
      id: collaboratorId,
      companyId,
      name: "Pedro Barber",
      phone: "+584122222222",
      email: "pedro@sur.com",
      passwordHash: "hash:Barber@123",
      specialty: "Barba",
      commissionPercentage: 45,
      isActive: true,
    });

    const wrongLogin = await testApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@sur.com", password: "wrong" },
    });
    expect(wrongLogin.statusCode).toBe(401);

    const collabLogin = await testApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "pedro@sur.com", password: "Barber@123" },
    });
    expect(collabLogin.statusCode).toBe(200);
    const { accessToken: collabToken } = collabLogin.json() as { accessToken: string };

    const collabMeOk = await testApp.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(collabMeOk.statusCode).toBe(200);

    // Desativa o colaborador: token já emitido deve ser rejeitado imediatamente e novo login bloqueado.
    repository.setCollaboratorActive(collaboratorId, false);

    const collabMeRevoked = await testApp.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(collabMeRevoked.statusCode).toBe(401);

    const collabLoginBlocked = await testApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "pedro@sur.com", password: "Barber@123" },
    });
    expect(collabLoginBlocked.statusCode).toBe(403);

    // Reativa colaborador mas desativa a empresa: sessão e login devem continuar bloqueados.
    repository.setCollaboratorActive(collaboratorId, true);
    repository.setCompanyActive(companyId, false);

    const collabMeCompanyInactive = await testApp.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(collabMeCompanyInactive.statusCode).toBe(401);

    const ownerLoginBlocked = await testApp.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "owner@sur.com", password: "Owner@123" },
    });
    expect(ownerLoginBlocked.statusCode).toBe(403);

    await testApp.close();
  });

  it("exposes /auth/register, /auth/login, and /me in the OpenAPI document", async () => {
    const response = await mainApp.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json() as { paths?: Record<string, Record<string, unknown>> };
    expect(spec.paths?.["/auth/register"]?.post).toBeDefined();
    expect(spec.paths?.["/auth/login"]?.post).toBeDefined();
    expect(spec.paths?.["/me"]?.get).toBeDefined();

    await testApp.close();
  });
});
