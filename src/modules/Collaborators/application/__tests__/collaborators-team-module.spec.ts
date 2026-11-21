import { describe, expect, it } from "vitest";
import { CountFutureAppointmentsUseCase } from "../count-future-appointments.usecase.js";
import { DeactivateCollaboratorUseCase } from "../deactivate-collaborator.usecase.js";
import { GetCollaboratorProfileUseCase } from "../get-collaborator-profile.usecase.js";
import { SyncCollaboratorScheduleUseCase } from "../sync-collaborator-schedule.usecase.js";
import { SyncCollaboratorServicesUseCase } from "../sync-collaborator-services.usecase.js";
import { UpdateCollaboratorCredentialsUseCase } from "../update-collaborator-credentials.usecase.js";
import { UpdateCollaboratorUseCase } from "../update-collaborator.usecase.js";
import {
  InvalidAvatarFileError,
  UploadCollaboratorAvatarUseCase,
} from "../upload-collaborator-avatar.usecase.js";
import { CollaboratorEntity } from "../../domain/entities/collaborator.entity.js";
import type {
  CollaboratorMetricSummary,
  CollaboratorProfileDossier,
  CollaboratorRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../../domain/repository/collaborators.repository.interface.js";
import {
  CollaboratorScheduleValidationError,
  type CollaboratorDayScheduleInput,
} from "../../domain/services/collaborator-schedule-validator.service.js";

class FakeCollaboratorsRepository implements CollaboratorsRepository {
  collaborator: CollaboratorEntity | null = null;
  savedServices: Array<{ serviceId: string; customCommissionRate?: number | null | undefined }> = [];
  savedSchedules: CollaboratorDayScheduleInput[] = [];
  futureCount = 3;
  deactivated = false;
  deactivationReason: string | null = null;

  async existsByEmail(): Promise<boolean> { return false; }
  async companyExistsById(): Promise<boolean> { return true; }
  async save(collaborator: CollaboratorEntity): Promise<void> { this.collaborator = collaborator; }
  async findById(): Promise<CollaboratorEntity | null> { return this.collaborator; }
  async findAllByCompanyId(): Promise<CollaboratorRecord[]> {
    if (!this.collaborator) return [];
    return [
      {
        id: this.collaborator.id,
        companyId: this.collaborator.companyId,
        name: this.collaborator.name,
        email: this.collaborator.email,
        phone: this.collaborator.phone,
        specialty: this.collaborator.specialty,
        commissionPercentage: this.collaborator.commissionPercentage,
        defaultCommissionRate: this.collaborator.defaultCommissionRate,
        status: this.collaborator.status,
        isActive: this.collaborator.isActive,
        hiredAt: this.collaborator.hiredAt,
        createdAt: this.collaborator.createdAt,
        updatedAt: this.collaborator.updatedAt,
      },
    ];
  }
  async update(collaborator: CollaboratorEntity): Promise<void> { this.collaborator = collaborator; }
  async updateStatusInCompany(): Promise<CollaboratorRecord | null> { return null; }
  async listCollaboratorsWithMetrics(): Promise<{ teamKpis: TeamKpisSummary; collaborators: CollaboratorMetricSummary[] }> {
    return {
      teamKpis: {
        totalCollaborators: 1,
        activeCollaborators: 1,
        totalCompletedAppointmentsMonth: 10,
        totalRevenueMonthInCents: 50000,
        averageTeamRating: 4.8,
      },
      collaborators: [],
    };
  }
  async getProfileDossier(): Promise<CollaboratorProfileDossier | null> {
    if (!this.collaborator) return null;
    return {
      collaborator: {
        id: this.collaborator.id,
        companyId: this.collaborator.companyId,
        name: this.collaborator.name,
        email: this.collaborator.email,
        phone: this.collaborator.phone,
        specialty: this.collaborator.specialty,
        commissionPercentage: this.collaborator.commissionPercentage,
        defaultCommissionRate: this.collaborator.defaultCommissionRate,
        status: this.collaborator.status,
        isActive: this.collaborator.isActive,
        hiredAt: this.collaborator.hiredAt,
        createdAt: this.collaborator.createdAt,
        updatedAt: this.collaborator.updatedAt,
      },
      tenureFormatted: "3 meses",
      tenureMonths: 3,
      ranking: {
        totalScore: 92.5,
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
          productsSalesScore: 22.5,
          appointmentsVolumeScore: 15,
          clientReviewsScore: 15,
          punctualityRetentionScore: 5,
        },
      },
      stats: {
        completedAppointmentsMonth: 15,
        totalCompletedAppointments: 45,
        servicesRevenueMonthInCents: 150000,
        productsSalesMonthInCents: 25000,
        productsSoldCountMonth: 3,
        revenueMonthInCents: 175000,
        totalRevenueInCents: 450000,
        commissionMonthInCents: 60000,
        totalCommissionInCents: 180000,
        averageRating: 5.0,
        totalReviews: 20,
      },
      awards: [
        {
          id: "award-1",
          title: "Melhor Funcionário do Mês",
          referenceMonth: "2026-10",
          score: 95.0,
          createdAt: new Date(),
        },
      ],
      recentReviews: [
        {
          id: "rev-1",
          clientName: "João Pedro",
          serviceName: "Corte Degradê",
          rating: 5,
          comment: "Excelente profissional!",
          createdAt: new Date(),
        },
      ],
      services: [],
      schedules: [],
    };
  }
  async syncServices(
    _collaboratorId: string,
    _companyId: string,
    services: Array<{ serviceId: string; customCommissionRate?: number | null | undefined }>,
  ): Promise<void> {
    this.savedServices = services;
  }
  async syncSchedules(
    _collaboratorId: string,
    _companyId: string,
    schedules: CollaboratorDayScheduleInput[],
  ): Promise<void> {
    this.savedSchedules = schedules;
  }
  async countFutureAppointments(): Promise<number> {
    return this.futureCount;
  }
  async deactivateAndQueueReschedule(
    _collaboratorId: string,
    _companyId: string,
    reason?: string | null | undefined,
    queueAi = true,
  ): Promise<{ queuedCount: number }> {
    this.deactivated = true;
    this.deactivationReason = reason ?? null;
    return { queuedCount: queueAi ? this.futureCount : 0 };
  }
}

describe("Collaborators Team Module - Stage 1 Use Cases", () => {
  const companyId = "c1111111-1111-4111-8111-111111111111";
  const collaboratorId = "collab-1";

  function makeEntity() {
    return CollaboratorEntity.reconstitute({
      id: collaboratorId,
      companyId,
      name: "Marcus Barbeiro",
      email: "marcus@barber.com",
      password: "hashed_password",
      phone: "+5511999999999",
      specialty: "Barbeiro Visagista",
      commissionPercentage: 40,
      defaultCommissionRate: 40,
      status: "ACTIVE",
      isActive: true,
      hiredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("retorna dossiê completo para o Bento Grid", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const useCase = new GetCollaboratorProfileUseCase(repo);

    const dossier = await useCase.execute(collaboratorId, companyId);
    expect(dossier.collaborator.name).toBe("Marcus Barbeiro");
    expect(dossier.ranking.totalScore).toBe(92.5);
    expect(dossier.awards).toHaveLength(1);
    expect(dossier.awards[0]?.title).toBe("Melhor Funcionário do Mês");
    expect(dossier.recentReviews[0]?.rating).toBe(5);
  });

  it("atualiza perfil e comissão padrão do colaborador", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const useCase = new UpdateCollaboratorUseCase(repo);

    const updated = await useCase.execute({
      collaboratorId,
      companyId,
      name: "Marcus Vinicius",
      specialty: "Master Barber",
      defaultCommissionRate: 45,
      monthlyRevenueGoal: 500000,
    });

    expect(updated.name).toBe("Marcus Vinicius");
    expect(repo.collaborator?.specialty).toBe("Master Barber");
    expect(repo.collaborator?.defaultCommissionRate).toBe(45);
    expect(repo.collaborator?.monthlyRevenueGoal).toBe(500000);
  });

  it("sincroniza serviços e comissões customizadas", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const useCase = new SyncCollaboratorServicesUseCase(repo);

    await useCase.execute({
      collaboratorId,
      companyId,
      services: [
        { serviceId: "srv-1", customCommissionRate: 50 },
        { serviceId: "srv-2", customCommissionRate: null },
      ],
    });

    expect(repo.savedServices).toHaveLength(2);
    expect(repo.savedServices[0]?.customCommissionRate).toBe(50);
    expect(repo.savedServices[1]?.customCommissionRate).toBeNull();
  });

  it("sincroniza jornada validada contra horário da empresa", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const useCase = new SyncCollaboratorScheduleUseCase(repo);

    const companyContext = {
      operatingSchedule: [
        { dayOfWeek: 1, isOpen: true, openTime: "08:00", closeTime: "19:00" },
      ],
    };

    const saved = await useCase.execute({
      collaboratorId,
      companyId,
      companyContext,
      schedules: [
        {
          dayOfWeek: 1,
          isWorkingDay: true,
          startTime: "09:00",
          endTime: "18:00",
          breakStartTime: "12:00",
          breakEndTime: "13:00",
        },
      ],
    });

    expect(saved).toHaveLength(1);
    expect(repo.savedSchedules[0]?.startTime).toBe("09:00");
  });

  it("rejeita jornada que extrapole horário da empresa", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const useCase = new SyncCollaboratorScheduleUseCase(repo);

    const companyContext = {
      operatingSchedule: [
        { dayOfWeek: 1, isOpen: true, openTime: "08:00", closeTime: "18:00" },
      ],
    };

    await expect(
      useCase.execute({
        collaboratorId,
        companyId,
        companyContext,
        schedules: [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "08:00",
            endTime: "20:00", // Ultrapassa 18:00
          },
        ],
      }),
    ).rejects.toBeInstanceOf(CollaboratorScheduleValidationError);
  });

  it("consulta contagem de agendamentos futuros e executa desativação com enfileiramento IA", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const countUseCase = new CountFutureAppointmentsUseCase(repo);
    const deactivateUseCase = new DeactivateCollaboratorUseCase(repo);

    const countResult = await countUseCase.execute(collaboratorId, companyId);
    expect(countResult.futureAppointmentsCount).toBe(3);

    const deactResult = await deactivateUseCase.execute({
      collaboratorId,
      companyId,
      reason: "Mudança de cidade",
      queueAiReschedule: true,
    });

    expect(deactResult.queuedCount).toBe(3);
    expect(repo.deactivated).toBe(true);
    expect(repo.deactivationReason).toBe("Mudança de cidade");
  });

  it("rejeita upload de arquivo de avatar com formato inválido", async () => {
    const repo = new FakeCollaboratorsRepository();
    repo.collaborator = makeEntity();
    const uploadUseCase = new UploadCollaboratorAvatarUseCase(repo);

    await expect(
      uploadUseCase.execute({
        collaboratorId,
        companyId,
        filename: "documento.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("fake-pdf"),
      }),
    ).rejects.toBeInstanceOf(InvalidAvatarFileError);
  });
});
