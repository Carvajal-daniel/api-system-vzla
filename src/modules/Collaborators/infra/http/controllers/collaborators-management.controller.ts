import type { FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import type { CloseMonthAwardUseCase } from "../../../application/close-month-award.usecase.js";
import type { CountFutureAppointmentsUseCase } from "../../../application/count-future-appointments.usecase.js";
import type { DeactivateCollaboratorUseCase } from "../../../application/deactivate-collaborator.usecase.js";
import type { GetCollaboratorProfileUseCase } from "../../../application/get-collaborator-profile.usecase.js";
import type { ListCompanyCollaboratorsUseCase } from "../../../application/list-company-collaborators.usecase.js";
import type { SyncCollaboratorScheduleUseCase } from "../../../application/sync-collaborator-schedule.usecase.js";
import type { SyncCollaboratorServicesUseCase } from "../../../application/sync-collaborator-services.usecase.js";
import type { UpdateCollaboratorCredentialsUseCase } from "../../../application/update-collaborator-credentials.usecase.js";
import type { UpdateCollaboratorStatusUseCase } from "../../../application/update-collaborator-status.usecase.js";
import type { UpdateCollaboratorUseCase } from "../../../application/update-collaborator.usecase.js";
import type { UploadCollaboratorAvatarUseCase } from "../../../application/upload-collaborator-avatar.usecase.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import type { DailyOperatingSchedule } from "../../../domain/services/collaborator-schedule-validator.service.js";
import {
  closeMonthAwardBodySchema,
  collaboratorIdParamSchema,
  deactivateCollaboratorBodySchema,
  listCollaboratorsQuerySchema,
  syncCollaboratorScheduleBodySchema,
  syncCollaboratorServicesBodySchema,
  updateCollaboratorBodySchema,
  updateCollaboratorCredentialsBodySchema,
  updateCollaboratorStatusBodySchema,
} from "../schemas/collaborator-http.schemas.js";

export interface CollaboratorsManagementControllerDeps {
  listCompanyCollaboratorsUseCase: ListCompanyCollaboratorsUseCase;
  getCollaboratorProfileUseCase?: GetCollaboratorProfileUseCase;
  updateCollaboratorUseCase?: UpdateCollaboratorUseCase;
  syncCollaboratorServicesUseCase?: SyncCollaboratorServicesUseCase;
  syncCollaboratorScheduleUseCase?: SyncCollaboratorScheduleUseCase;
  updateCollaboratorCredentialsUseCase?: UpdateCollaboratorCredentialsUseCase;
  countFutureAppointmentsUseCase?: CountFutureAppointmentsUseCase;
  deactivateCollaboratorUseCase?: DeactivateCollaboratorUseCase;
  uploadCollaboratorAvatarUseCase?: UploadCollaboratorAvatarUseCase;
  closeMonthAwardUseCase?: CloseMonthAwardUseCase;
  updateCollaboratorStatusUseCase: UpdateCollaboratorStatusUseCase;
  collaboratorsRepository?: CollaboratorsRepository;
}

export class CollaboratorsManagementController {
  constructor(private readonly deps: CollaboratorsManagementControllerDeps) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const query = listCollaboratorsQuerySchema.safeParse(request.query);
    const serviceId = query.success ? query.data.serviceId : undefined;
    const status = query.success ? query.data.status : undefined;
    const includeMetrics = query.success ? query.data.includeMetrics : true;

    if (serviceId || !includeMetrics) {
      const collaborators = await this.deps.listCompanyCollaboratorsUseCase.execute(
        request.actor.companyId,
        { serviceId, status: status ?? (serviceId ? "ACTIVE" : undefined) },
      );
      return reply.status(200).send({ collaborators });
    }

    const result = await this.deps.listCompanyCollaboratorsUseCase.executeWithMetrics(
      request.actor.companyId,
    );

    return reply.status(200).send(result);
  }

  async getProfile(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    if (!this.deps.getCollaboratorProfileUseCase) {
      return reply.status(501).send({ message: "Profile use case not configured." });
    }

    const dossier = await this.deps.getCollaboratorProfileUseCase.execute(
      collaboratorId,
      request.actor.companyId,
    );

    return reply.status(200).send(dossier);
  }

  async updateDetails(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const body = updateCollaboratorBodySchema.parse(request.body);

    if (!this.deps.updateCollaboratorUseCase) {
      return reply.status(501).send({ message: "Update use case not configured." });
    }

    const updated = await this.deps.updateCollaboratorUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      name: body.name,
      phone: body.phone,
      whatsapp: body.whatsapp,
      specialty: body.specialty,
      bio: body.bio,
      commissionPercentage: body.commissionPercentage,
      defaultCommissionRate: body.defaultCommissionRate,
      monthlyRevenueGoal: body.monthlyRevenueGoal,
      avatarUrl: body.avatarUrl,
      hiredAt: body.hiredAt,
    });

    return reply.status(200).send({ ...updated, role: "COLLABORATOR" as const });
  }

  async uploadAvatar(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    if (!this.deps.uploadCollaboratorAvatarUseCase) {
      return reply.status(501).send({ message: "Avatar upload use case not configured." });
    }

    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: "Nenhum arquivo enviado no corpo da requisição." });
    }

    const buffer = await file.toBuffer();
    const result = await this.deps.uploadCollaboratorAvatarUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      filename: file.filename,
      mimetype: file.mimetype,
      buffer,
    });

    return reply.status(200).send(result);
  }

  async syncServices(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const { services } = syncCollaboratorServicesBodySchema.parse(request.body);

    if (!this.deps.syncCollaboratorServicesUseCase) {
      return reply.status(501).send({ message: "Sync services use case not configured." });
    }

    await this.deps.syncCollaboratorServicesUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      services: services.map((s) => ({
        serviceId: s.serviceId,
        customCommissionRate: s.customCommissionRate ?? null,
      })),
    });

    return reply.status(200).send({ message: "Serviços vinculados com sucesso." });
  }

  async syncSchedule(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const { schedules } = syncCollaboratorScheduleBodySchema.parse(request.body);

    if (!this.deps.syncCollaboratorScheduleUseCase) {
      return reply.status(501).send({ message: "Sync schedule use case not configured." });
    }

    const [companyRow] = await db
      .select({
        operatingDays: CompanyTable.operatingDays,
        operatingSchedule: CompanyTable.operatingSchedule,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, request.actor.companyId))
      .limit(1);

    const companyContext = {
      operatingDays: companyRow?.operatingDays ?? null,
      operatingSchedule: (companyRow?.operatingSchedule as DailyOperatingSchedule[]) ?? null,
    };

    const savedSchedules = await this.deps.syncCollaboratorScheduleUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      schedules: schedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        isWorkingDay: s.isWorkingDay,
        startTime: s.startTime ?? null,
        endTime: s.endTime ?? null,
        breakStartTime: s.breakStartTime ?? null,
        breakEndTime: s.breakEndTime ?? null,
      })),
      companyContext,
    });

    return reply.status(200).send({ schedules: savedSchedules });
  }

  async updateCredentials(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const body = updateCollaboratorCredentialsBodySchema.parse(request.body);

    if (!this.deps.updateCollaboratorCredentialsUseCase) {
      return reply.status(501).send({ message: "Credentials use case not configured." });
    }

    await this.deps.updateCollaboratorCredentialsUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      email: body.email,
      password: body.password,
    });

    return reply.status(200).send({ message: "Credenciais atualizadas com sucesso." });
  }

  async futureAppointmentsCount(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    if (!this.deps.countFutureAppointmentsUseCase) {
      return reply.status(501).send({ message: "Future appointments use case not configured." });
    }

    const result = await this.deps.countFutureAppointmentsUseCase.execute(
      collaboratorId,
      request.actor.companyId,
    );

    return reply.status(200).send(result);
  }

  async deactivate(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const { reason, queueAiReschedule } = deactivateCollaboratorBodySchema.parse(request.body);

    if (!this.deps.deactivateCollaboratorUseCase) {
      return reply.status(501).send({ message: "Deactivate use case not configured." });
    }

    const result = await this.deps.deactivateCollaboratorUseCase.execute({
      collaboratorId,
      companyId: request.actor.companyId,
      reason: reason ?? null,
      queueAiReschedule,
    });

    return reply.status(200).send(result);
  }

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const { isActive } = updateCollaboratorStatusBodySchema.parse(request.body);

    const updated = await this.deps.updateCollaboratorStatusUseCase.execute({
      actorUserId: request.actor.userId,
      companyId: request.actor.companyId,
      collaboratorId,
      isActive,
    });

    return reply.status(200).send(updated);
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const repo = this.deps.collaboratorsRepository;
    if (!repo?.deleteInCompany) {
      return reply.status(501).send({ message: "Collaborator delete is not supported." });
    }

    const outcome = await repo.deleteInCompany(collaboratorId, request.actor.companyId);

    if (outcome === "not_found") {
      return reply.status(404).send({ message: "Collaborator not found." });
    }
    if (outcome === "has_appointments") {
      return reply.status(409).send({
        message: "Cannot delete collaborator with associated appointments.",
      });
    }

    return reply.status(204).send();
  }

  async closeMonthAward(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { referenceMonth } = closeMonthAwardBodySchema.parse(request.body);
    if (!this.deps.closeMonthAwardUseCase) {
      return reply.status(501).send({ message: "Close month award use case not configured." });
    }

    const award = await this.deps.closeMonthAwardUseCase.execute(
      request.actor.companyId,
      referenceMonth,
    );

    return reply.status(201).send(award);
  }
}
