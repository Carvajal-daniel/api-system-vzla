import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import type { CollaboratorEntity } from "../../domain/entities/collaborator.entity.js";
import type { CollaboratorsRepository } from "../../domain/repository/collaborators.repository.interface.js";
import {
  CollaboratorCompanyNotFoundError,
  CollaboratorEmailAlreadyInError,
} from "../errors/collaborator-errors.js";
import { RegisterCollaboratorUseCase } from "../register-collaborator.usecase.js";

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
  readonly collaborators: CollaboratorEntity[] = [];

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
    this.collaborators.push(collaborator);
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
});
