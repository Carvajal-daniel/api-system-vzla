import { describe, expect, it } from "vitest";
import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import { CollaboratorEntity } from "../../domain/entities/collaborator.entity.js";
import type {
  CollaboratorMetricSummary,
  CollaboratorProfileDossier,
  CollaboratorRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../../domain/repository/collaborators.repository.interface.js";
import type { CollaboratorDayScheduleInput } from "../../domain/services/collaborator-schedule-validator.service.js";
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

    return CollaboratorEntity.reconstitute({
      id: found.id,
      companyId: found.companyId,
      name: found.name,
      email: found.email,
      password: found.password,
      phone: found.phone,
      whatsapp: found.whatsapp ?? null,
      specialty: found.specialty,
      bio: found.bio ?? null,
      commissionPercentage: found.commissionPercentage,
      defaultCommissionRate: found.defaultCommissionRate,
      monthlyRevenueGoal: found.monthlyRevenueGoal ?? null,
      status: found.status,
      isActive: found.isActive,
      avatarUrl: found.avatarUrl ?? null,
      hiredAt: found.hiredAt,
      deactivatedAt: found.deactivatedAt ?? null,
      deactivationReason: found.deactivationReason ?? null,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
    });
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
    const index = this.collaborators.findIndex(
      (c) => c.id === collaborator.id && c.companyId === collaborator.companyId,
    );
    if (index !== -1) {
      this.collaborators[index] = {
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
        commissionPercentage: 50,
      }),
    ).rejects.toBeInstanceOf(CollaboratorCompanyNotFoundError);
  });

  it("rejects registration when email is already taken by collaborator or company", async () => {
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
      commissionPercentage: 50,
    });

    await expect(
      useCase.execute({
        name: "Outro Nome",
        email: " Carlos@Barber.com ",
        password: "AnotherPassword@123",
        phone: "+584120000000",
        companyId,
        specialty: "Barba",
        commissionPercentage: 30,
      }),
    ).rejects.toBeInstanceOf(CollaboratorEmailAlreadyInError);

    await expect(
      useCase.execute({
        name: "Outro Nome",
        email: " OWNER@barber.com ",
        password: "AnotherPassword@123",
        phone: "+584120000000",
        companyId,
        specialty: "Barba",
        commissionPercentage: 30,
      }),
    ).rejects.toBeInstanceOf(CollaboratorEmailAlreadyInError);
  });

  it("updates collaborator status to inactive and active again", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    const registerUseCase = new RegisterCollaboratorUseCase(
      repository,
      new FakePasswordHasher(),
    );
    const updateStatusUseCase = new UpdateCollaboratorStatusUseCase(repository);

    const created = await registerUseCase.execute({
      name: "Carlos Silva",
      email: "carlos@barber.com",
      password: "Secret@123",
      phone: "+584121234567",
      companyId,
      specialty: "Corte",
      commissionPercentage: 40,
    });

    const deactivated = await updateStatusUseCase.execute({
      actorUserId: "owner-user-id",
      companyId,
      collaboratorId: created.id,
      isActive: false,
    });
    expect(deactivated.isActive).toBe(false);

    const reactivated = await updateStatusUseCase.execute({
      actorUserId: "owner-user-id",
      companyId,
      collaboratorId: created.id,
      isActive: true,
    });
    expect(reactivated.isActive).toBe(true);
  });

  it("validates boundary conditions when updating status", async () => {
    const repository = new InMemoryCollaboratorsRepository();
    repository.seedCompany(companyId, "owner@barber.com");
    const updateStatusUseCase = new UpdateCollaboratorStatusUseCase(repository);

    await expect(
      updateStatusUseCase.execute({
        actorUserId: "owner-user-id",
        companyId,
        collaboratorId: "owner-user-id",
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(CannotModifyOwnOwnerStatusError);

    await expect(
      updateStatusUseCase.execute({
        actorUserId: "owner-user-id",
        companyId,
        collaboratorId: "non-existent-id",
        isActive: false,
      }),
    ).rejects.toBeInstanceOf(CollaboratorRecordNotFoundError);
  });
});
