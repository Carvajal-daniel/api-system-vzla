import { beforeEach, describe, expect, it } from "vitest";
import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import { InvalidPasswordError } from "../../../../shared/Errors/invalid-password.js";
import {
  AuthEmailAlreadyInUseError,
  AuthenticatedActorNotFoundError,
  InactiveAccountError,
  InvalidCredentialsError,
} from "../../domain/errors/auth-errors.js";
import type { AccessTokenPayload, SignedAccessToken, TokenService } from "../ports/token-service.js";
import { GetAuthenticatedProfileUseCase } from "../use-cases/get-authenticated-profile.use-case.js";
import { LoginUseCase } from "../use-cases/login.use-case.js";
import { RegisterOwnerUseCase } from "../use-cases/register-owner.use-case.js";
import { InMemoryAuthIdentityRepository } from "./in-memory-auth-identity.repository.js";

class FakePasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return `hashed::${plainText}`;
  }

  async compare(plainText: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `hashed::${plainText}`;
  }
}

class FakeTokenService implements TokenService {
  signAccessToken(payload: AccessTokenPayload): SignedAccessToken {
    return {
      accessToken: `token::${payload.role}::${payload.sub}::${payload.companyId}`,
      tokenType: "Bearer",
      expiresIn: "1d",
    };
  }
}

describe("Auth Use Cases", () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const collaboratorId = "22222222-2222-4222-8222-222222222222";

  let repository: InMemoryAuthIdentityRepository;
  let passwordHasher: FakePasswordHasher;
  let tokenService: FakeTokenService;
  let registerOwnerUseCase: RegisterOwnerUseCase;
  let loginUseCase: LoginUseCase;
  let getProfileUseCase: GetAuthenticatedProfileUseCase;

  beforeEach(() => {
    repository = new InMemoryAuthIdentityRepository();
    passwordHasher = new FakePasswordHasher();
    tokenService = new FakeTokenService();

    registerOwnerUseCase = new RegisterOwnerUseCase(repository, passwordHasher, tokenService);
    loginUseCase = new LoginUseCase(repository, passwordHasher, tokenService);
    getProfileUseCase = new GetAuthenticatedProfileUseCase(repository);
  });

  describe("RegisterOwnerUseCase", () => {
    it("registers a new owner company with normalized email and issues an OWNER JWT", async () => {
      const result = await registerOwnerUseCase.execute({
        companyName: "  Barbearia Central  ",
        name: "  Carlos Silva ",
        phone: " +584121234567 ",
        email: "  Owner@Central.COM ",
        password: "Secret@123",
      });

      expect(result.tokenType).toBe("Bearer");
      expect(result.expiresIn).toBe("1d");
      expect(result.user.role).toBe("OWNER");
      expect(result.user.email).toBe("owner@central.com");
      expect(result.user.companyName).toBe("Barbearia Central");
      expect(result.user.id).toBe(result.user.companyId);
      expect(repository.companies).toHaveLength(1);
      expect(repository.companies[0]?.passwordHash).toBe("hashed::Secret@123");
    });

    it("rejects duplicate email already registered in companies or collaborators", async () => {
      repository.seedCompany({
        id: companyId,
        companyName: "Salon A",
        name: "Owner A",
        phone: "584121234567",
        email: "taken@salon.com",
        passwordHash: "hashed::Secret@123",
        isActive: true,
      });

      await expect(
        registerOwnerUseCase.execute({
          companyName: "Salon B",
          name: "Owner B",
          phone: "584129999999",
          email: "TAKEN@SALON.COM",
          password: "Secret@123",
        }),
      ).rejects.toBeInstanceOf(AuthEmailAlreadyInUseError);

      repository.seedCollaborator({
        id: collaboratorId,
        companyId,
        name: "Barber One",
        phone: "584128888888",
        email: "barber@salon.com",
        passwordHash: "hashed::Secret@123",
        specialty: "Fade",
        commissionPercentage: 40,
        isActive: true,
      });

      await expect(
        registerOwnerUseCase.execute({
          companyName: "Salon C",
          name: "Owner C",
          phone: "584127777777",
          email: "barber@salon.com",
          password: "Secret@123",
        }),
      ).rejects.toBeInstanceOf(AuthEmailAlreadyInUseError);
    });

    it("enforces the existing company password policy on register", async () => {
      await expect(
        registerOwnerUseCase.execute({
          companyName: "Salon Weak",
          name: "Owner Weak",
          phone: "584121234567",
          email: "weak@salon.com",
          password: "password123",
        }),
      ).rejects.toBeInstanceOf(InvalidPasswordError);
    });
  });

  describe("LoginUseCase", () => {
    beforeEach(() => {
      repository.seedCompany({
        id: companyId,
        companyName: "Barbearia Elite",
        name: "Ana Owner",
        phone: "584121234567",
        email: "owner@elite.com",
        passwordHash: "hashed::Owner@123",
        isActive: true,
      });

      repository.seedCollaborator({
        id: collaboratorId,
        companyId,
        name: "Luis Barber",
        phone: "584127654321",
        email: "barber@elite.com",
        passwordHash: "hashed::simplepass",
        specialty: "Corte",
        commissionPercentage: 50,
        isActive: true,
      });
    });

    it("authenticates an active OWNER and an active COLLABORATOR", async () => {
      const ownerLogin = await loginUseCase.execute({
        email: "  OWNER@ELITE.COM ",
        password: "Owner@123",
      });
      expect(ownerLogin.user.role).toBe("OWNER");
      expect(ownerLogin.user.id).toBe(companyId);

      const collaboratorLogin = await loginUseCase.execute({
        email: "barber@elite.com",
        password: "simplepass",
      });
      expect(collaboratorLogin.user.role).toBe("COLLABORATOR");
      expect(collaboratorLogin.user.id).toBe(collaboratorId);
      expect(collaboratorLogin.user.companyId).toBe(companyId);
    });

    it("rejects unknown email or wrong password with InvalidCredentialsError", async () => {
      await expect(
        loginUseCase.execute({ email: "ghost@elite.com", password: "Owner@123" }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      await expect(
        loginUseCase.execute({ email: "owner@elite.com", password: "WrongPassword!" }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it("blocks login when owner, collaborator, or parent company is inactive", async () => {
      repository.setCompanyActive(companyId, false);

      await expect(
        loginUseCase.execute({ email: "owner@elite.com", password: "Owner@123" }),
      ).rejects.toBeInstanceOf(InactiveAccountError);

      await expect(
        loginUseCase.execute({ email: "barber@elite.com", password: "simplepass" }),
      ).rejects.toBeInstanceOf(InactiveAccountError);

      repository.setCompanyActive(companyId, true);
      repository.setCollaboratorActive(collaboratorId, false);

      await expect(
        loginUseCase.execute({ email: "barber@elite.com", password: "simplepass" }),
      ).rejects.toBeInstanceOf(InactiveAccountError);
    });
  });

  describe("GetAuthenticatedProfileUseCase", () => {
    beforeEach(() => {
      repository.seedCompany({
        id: companyId,
        companyName: "Barbearia Elite",
        name: "Ana Owner",
        phone: "584121234567",
        email: "owner@elite.com",
        passwordHash: "hashed::Owner@123",
        isActive: true,
      });

      repository.seedCollaborator({
        id: collaboratorId,
        companyId,
        name: "Luis Barber",
        phone: "584127654321",
        email: "barber@elite.com",
        passwordHash: "hashed::simplepass",
        specialty: "Corte",
        commissionPercentage: 50,
        isActive: true,
      });
    });

    it("returns fresh profile for active owner and active collaborator", async () => {
      const ownerProfile = await getProfileUseCase.execute({
        role: "OWNER",
        userId: companyId,
        companyId,
      });
      expect(ownerProfile.role).toBe("OWNER");
      expect(ownerProfile.company.companyName).toBe("Barbearia Elite");

      const collaboratorProfile = await getProfileUseCase.execute({
        role: "COLLABORATOR",
        collaboratorId,
        companyId,
      });
      expect(collaboratorProfile.role).toBe("COLLABORATOR");
      if (collaboratorProfile.role === "COLLABORATOR") {
        expect(collaboratorProfile.specialty).toBe("Corte");
        expect(collaboratorProfile.commissionPercentage).toBe(50);
      }
    });

    it("rejects profile retrieval when owner or collaborator/company is deactivated", async () => {
      repository.setCollaboratorActive(collaboratorId, false);
      await expect(
        getProfileUseCase.execute({
          role: "COLLABORATOR",
          collaboratorId,
          companyId,
        }),
      ).rejects.toBeInstanceOf(AuthenticatedActorNotFoundError);

      repository.setCollaboratorActive(collaboratorId, true);
      repository.setCompanyActive(companyId, false);

      await expect(
        getProfileUseCase.execute({
          role: "OWNER",
          userId: companyId,
          companyId,
        }),
      ).rejects.toBeInstanceOf(AuthenticatedActorNotFoundError);

      await expect(
        getProfileUseCase.execute({
          role: "COLLABORATOR",
          collaboratorId,
          companyId,
        }),
      ).rejects.toBeInstanceOf(AuthenticatedActorNotFoundError);
    });
  });
});
