import fastify, { type FastifyInstance } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CollaboratorRoutes } from "../../../modules/Collaborators/infra/http/routers/collaborator-routes.js";
import { CollaboratorEntity } from "../../../modules/Collaborators/domain/entities/collaborator.entity.js";
import type {
  CollaboratorMetricSummary,
  CollaboratorProfileDossier,
  CollaboratorRecord,
  CollaboratorsRepository,
  TeamKpisSummary,
} from "../../../modules/Collaborators/domain/repository/collaborators.repository.interface.js";
import type { CollaboratorDayScheduleInput } from "../../../modules/Collaborators/domain/services/collaborator-schedule-validator.service.js";
import type { PasswordHasher } from "../../cryptography/password-hasher.js";
import { registerErrorHandler } from "../error-handler.js";

import { resetActorStatusVerifier, setActorStatusVerifier } from "../auth/authenticate.js";

class FastTestPasswordHasher implements PasswordHasher {
  async hash(plainText: string): Promise<string> {
    return `hash:${plainText}`;
  }

  async compare(plainText: string, passwordHash: string): Promise<boolean> {
    return passwordHash === `hash:${plainText}`;
  }
}

class InMemoryCollaboratorsFullRepository implements CollaboratorsRepository {
  collaborator: CollaboratorEntity | null = null;
  savedServices: Array<{ serviceId: string; customCommissionRate?: number | null | undefined }> = [];
  savedSchedules: CollaboratorDayScheduleInput[] = [];

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
        totalCompletedAppointmentsMonth: 12,
        totalRevenueMonthInCents: 120000,
        averageTeamRating: 4.9,
      },
      collaborators: [
        {
          id: this.collaborator?.id ?? "c1",
          companyId: this.collaborator?.companyId ?? "comp1",
          name: this.collaborator?.name ?? "Pedro",
          email: this.collaborator?.email ?? "pedro@barber.com",
          phone: this.collaborator?.phone ?? "+5511999999999",
          role: "COLLABORATOR" as const,
          commissionPercentage: 40,
          hiredAt: new Date(),
          avatarUrl: null,
          specialty: "Barba",
          status: "ACTIVE",
          isActive: true,
          defaultCommissionRate: 40,
          completedAppointmentsMonth: 12,
          servicesRevenueMonthInCents: 100000,
          productsSalesMonthInCents: 20000,
          productsSoldCountMonth: 2,
          revenueMonthInCents: 120000,
          commissionMonthInCents: 48000,
          averageRating: 4.9,
          totalReviews: 10,
          rankingPosition: 1,
          rankingScore: 92,
          awardsCount: 1,
        },
      ],
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
      tenureFormatted: "6 meses",
      tenureMonths: 6,
      ranking: {
        totalScore: 92,
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
          productsSalesScore: 23,
          appointmentsVolumeScore: 15,
          clientReviewsScore: 15,
          punctualityRetentionScore: 4,
        },
      },
      stats: {
        completedAppointmentsMonth: 12,
        totalCompletedAppointments: 50,
        servicesRevenueMonthInCents: 100000,
        productsSalesMonthInCents: 20000,
        productsSoldCountMonth: 2,
        revenueMonthInCents: 120000,
        totalRevenueInCents: 500000,
        commissionMonthInCents: 48000,
        totalCommissionInCents: 200000,
        averageRating: 4.9,
        totalReviews: 10,
      },
      awards: [],
      recentReviews: [],
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
  async countFutureAppointments(): Promise<number> { return 4; }
  async deactivateAndQueueReschedule(): Promise<{ queuedCount: number }> {
    if (this.collaborator) {
      this.collaborator.deactivate("Desligamento solicitado");
    }
    return { queuedCount: 4 };
  }
}

describe("Collaborators Team Endpoints - Stage 1 HTTP Layer", () => {
  const testSecret = "test-jwt-secret-stage1";
  const companyId = "11111111-1111-4111-8111-111111111111";
  const collaboratorId = "22222222-2222-4222-8222-222222222222";

  let testApp: FastifyInstance;
  let repo: InMemoryCollaboratorsFullRepository;

  const ownerToken = jwt.sign(
    { sub: companyId, companyId, role: "OWNER" },
    testSecret,
    { expiresIn: "1h" },
  );

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
  });

  beforeEach(async () => {
    setActorStatusVerifier(async () => true);
    repo = new InMemoryCollaboratorsFullRepository();
    repo.collaborator = CollaboratorEntity.reconstitute({
      id: collaboratorId,
      companyId,
      name: "Marcus Aurelius",
      email: "marcus@barber.com",
      password: "hashed_pass",
      phone: "+5511988887777",
      specialty: "Barbeiro Sênior",
      commissionPercentage: 40,
      defaultCommissionRate: 40,
      status: "ACTIVE",
      isActive: true,
      hiredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    testApp = fastify({ logger: false });
    testApp.register(fastifyMultipart);
    registerErrorHandler(testApp);
    await testApp.register(CollaboratorRoutes, {
      collaboratorsRepository: repo,
      passwordHasher: new FastTestPasswordHasher(),
    });
    await testApp.ready();
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    await testApp.close();
  });

  it("GET /collaborators/:id/profile retorna dossiê completo para Bento Grid", async () => {
    const res = await testApp.inject({
      method: "GET",
      url: `/collaborators/${collaboratorId}/profile`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.collaborator.name).toBe("Marcus Aurelius");
    expect(body.ranking.totalScore).toBe(92);
    expect(body.stats.completedAppointmentsMonth).toBe(12);
  });

  it("PATCH /collaborators/:id atualiza campos enriquecidos de perfil", async () => {
    const res = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${collaboratorId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: "Marcus Aurelius Atualizado",
        specialty: "Master Barber",
        bio: "Especialista em visagismo e barba clássica",
        defaultCommissionRate: 45,
        monthlyRevenueGoal: 300000,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.collaborator?.name).toBe("Marcus Aurelius Atualizado");
    expect(repo.collaborator?.specialty).toBe("Master Barber");
    expect(repo.collaborator?.defaultCommissionRate).toBe(45);
  });

  it("PUT /collaborators/:id/services sincroniza lista de serviços e comissão personalizada", async () => {
    const serviceUuid = "33333333-3333-4333-8333-333333333333";
    const res = await testApp.inject({
      method: "PUT",
      url: `/collaborators/${collaboratorId}/services`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        services: [
          { serviceId: serviceUuid, customCommissionRate: 50 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.savedServices).toHaveLength(1);
    expect(repo.savedServices[0]?.customCommissionRate).toBe(50);
  });

  it("PATCH /collaborators/:id/credentials atualiza email e senha", async () => {
    const res = await testApp.inject({
      method: "PATCH",
      url: `/collaborators/${collaboratorId}/credentials`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        password: "NovaSenha@123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(repo.collaborator?.password).toBe("hash:NovaSenha@123");
  });

  it("GET /collaborators/:id/future-appointments-count e POST /collaborators/:id/deactivate", async () => {
    const countRes = await testApp.inject({
      method: "GET",
      url: `/collaborators/${collaboratorId}/future-appointments-count`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(countRes.statusCode).toBe(200);
    expect(countRes.json()).toEqual({ futureAppointmentsCount: 4 });

    const deactRes = await testApp.inject({
      method: "POST",
      url: `/collaborators/${collaboratorId}/deactivate`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        reason: "Desligamento por acordo mútuo",
        queueAiReschedule: true,
      },
    });

    expect(deactRes.statusCode).toBe(200);
    expect(deactRes.json().queuedCount).toBe(4);
    expect(repo.collaborator?.status).toBe("INACTIVE");
    expect(repo.collaborator?.isActive).toBe(false);
  });
});
