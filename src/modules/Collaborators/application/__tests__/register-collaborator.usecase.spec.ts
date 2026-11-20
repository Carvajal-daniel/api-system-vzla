import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import type { CollaboratorEntity } from "../../domain/entities/collaborator.entity.js";
import type {
  CollaboratorRecord,
  CollaboratorsRepository,
} from "../../domain/repository/collaborators.repository.interface.js";
import {
  CannotModifyOwnOwnerStatusError,
  CollaboratorCompanyNotFoundError,
  CollaboratorEmailAlreadyInError,
  CollaboratorRecordNotFoundError,
} from "../errors/collaborator-errors.js";
import { ListCompanyCollaboratorsUseCase } from "../list-company-collaborators.usecase.js";
import { RegisterCollaboratorUseCase } from "../register-collaborator.usecase.js";
import { UpdateCollaboratorStatusUseCase } from "../update-collaborator-status.usecase.js";

class FakePasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return `hashed:${plainText}`;
  }

  async compare(plainText: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `hashed:${plainText}`;
  }
}

class InMemoryCollaboratorsRepository implements CollaboratorsRepository {
  readonly companies = new Map<string, { id: string; email: string }>();
  readonly collaborators: Array<CollaboratorRecord & { password: string }> = [];

  seedCompany(id: string, email: string): void {
    this.companies.set(id, { id, email: email.trim().toLowerCase() });
  }

  async existsByEmail(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const existsInCollaborators = this.collaborators.some((c) => c.email === normalized);
    const existsInCompanies = Array.from(this.companies.values()).some(
      (company) => company.email === normalized,
    );

    return existsInCollaborators || existsInCompanies;
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
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
    });
  }

  async findAllByCompanyId(companyId: string): Promise<CollaboratorRecord[]> {
    return this.collaborators
      .filter((c) => c.companyId === companyId)
      .map(({ password: _password, ...record }) => ({ ...record }));
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
      id: found.id,
      companyId: found.companyId,
      name: found.name,
      email: found.email,
      phone: found.phone,
      specialty: found.specialty,
      commissionPercentage: found.commissionPercentage,
      isActive,
    };
    const index = this.collaborators.indexOf(found);
    this.collaborators[index] = { ...updated, password: found.password };
    return updated;
  }
}

describe("RegisterCollaboratorUseCase", () => {
  const companyId = "11111111-1111-4111-8111-111111111111";

  it("creates a collaborator with normalized email, trimmed fields, and hashed password", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    const useCase = new RegisterCollaboratorUseCase(repository, new FakePasswordHasher());

    const output = await useCase.execute({
      name: "  Carlos Silva  ",
      email: "  Carlos@Barber.com  ",
      password: "Secret@123",
      phone: " +584121234567 ",
      companyId,
      specialty: "  Corte e Barba  ",
      commissionPercentage: 40,
    });

    expect(output.id).toBeTruthy();
    expect(output.name).toBe("Carlos Silva");
    expect(output.email).toBe("carlos@barber.com");
    expect(output.companyId).toBe(companyId);
    expect(output.specialty).toBe("Corte e Barba");
    expect(output.commissionPercentage).toBe(40);
    expect(output.isActive).toBe(true);
    expect("password" in output).toBe(false);

    expect(repository.collaborators).toHaveLength(1);
    expect(repository.collaborators[0]?.password).toBe("hashed:Secret@123");
    expect(repository.collaborators[0]?.phone).toBe("+584121234567");
  });

  it("rejects registration when company does not exist", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    const useCase = new RegisterCollaboratorUseCase(repository, new FakePasswordHasher());

    await expect(
      useCase.execute({
        name: "Carlos Silva",
        email: "carlos@barber.com",
        password: "Secret@123",
        phone: "+584121234567",
        companyId,
        specialty: "Corte",
        commissionPercentage: 40,
      }),
    ).rejects.toBeInstanceOf(CollaboratorCompanyNotFoundError);
  });

  it("rejects registration when email already exists in collaborators", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    const useCase = new RegisterCollaboratorUseCase(repository, new FakePasswordHasher());

    await useCase.execute({
      name: "Carlos Silva",
      email: "carlos@barber.com",
      password: "Secret@123",
      phone: "+584121234567",
      companyId,
      specialty: "Corte",
      commissionPercentage: 40,
    });

    await expect(
      useCase.execute({
        name: "Outro Carlos",
        email: "CARLOS@barber.com",
        password: "Secret@123",
        phone: "+584129999999",
        companyId,
        specialty: "Barba",
        commissionPercentage: 35,
      }),
    ).rejects.toBeInstanceOf(CollaboratorEmailAlreadyInError);
  });

  it("rejects registration when email already exists in companies", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    const useCase = new RegisterCollaboratorUseCase(repository, new FakePasswordHasher());

    await expect(
      useCase.execute({
        name: "Carlos Silva",
        email: "OWNER@barber.com",
        password: "Secret@123",
        phone: "+584121234567",
        companyId,
        specialty: "Corte",
        commissionPercentage: 40,
      }),
    ).rejects.toBeInstanceOf(CollaboratorEmailAlreadyInError);
  });

  it("lists collaborators scoped to company and updates status while blocking self-deactivation and cross-tenant updates", async () => {
    const otherCompanyId = "22222222-2222-4222-8222-222222222222";
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    repository.seedCompany(otherCompanyId, "owner@other.com");

    const registerUseCase = new RegisterCollaboratorUseCase(repository, new FakePasswordHasher());
    const listUseCase = new ListCompanyCollaboratorsUseCase(repository);
    const updateStatusUseCase = new UpdateCollaboratorStatusUseCase(repository);

    const createdA = await registerUseCase.execute({
      name: "Carlos Silva",
      email: "carlos@barber.com",
      password: "Secret@123",
      phone: "+584121234567",
      companyId,
      specialty: "Corte",
      commissionPercentage: 40,
    });
    await registerUseCase.execute({
      name: "Outro Barbeiro",
      email: "outro@other.com",
      password: "Secret@123",
      phone: "+584129999999",
      companyId: otherCompanyId,
      specialty: "Barba",
      commissionPercentage: 50,
    });

    const listA = await listUseCase.execute(companyId);
    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({
      id: createdA.id,
      name: "Carlos Silva",
      email: "carlos@barber.com",
      phone: "+584121234567",
      specialty: "Corte",
      commissionPercentage: 40,
      isActive: true,
      role: "COLLABORATOR",
    });

    const deactivated = await updateStatusUseCase.execute({
      actorUserId: companyId,
      companyId,
      collaboratorId: createdA.id,
      isActive: false,
    });
    expect(deactivated.isActive).toBe(false);

    await expect(
      updateStatusUseCase.execute({
        actorUserId: companyId,
        companyId,
        collaboratorId: companyId,
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(CannotModifyOwnOwnerStatusError);

    await expect(
      updateStatusUseCase.execute({
        actorUserId: otherCompanyId,
        companyId: otherCompanyId,
        collaboratorId: createdA.id,
        isActive: true,
      }),
    ).rejects.toBeInstanceOf(CollaboratorRecordNotFoundError);
  });
});
