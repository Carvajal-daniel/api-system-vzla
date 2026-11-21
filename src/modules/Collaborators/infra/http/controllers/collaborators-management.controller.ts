import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ListCompanyCollaboratorsUseCase } from "../../../application/list-company-collaborators.usecase.js";
import type { UpdateCollaboratorStatusUseCase } from "../../../application/update-collaborator-status.usecase.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import {
  collaboratorIdParamSchema,
  updateCollaboratorStatusBodySchema,
} from "../schemas/collaborator-http.schemas.js";

export interface CollaboratorsManagementControllerDeps {
  listCompanyCollaboratorsUseCase: ListCompanyCollaboratorsUseCase;
  updateCollaboratorStatusUseCase: UpdateCollaboratorStatusUseCase;
  collaboratorsRepository?: CollaboratorsRepository;
}

export class CollaboratorsManagementController {
  constructor(private readonly deps: CollaboratorsManagementControllerDeps) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const collaborators = await this.deps.listCompanyCollaboratorsUseCase.execute(
      request.actor.companyId,
    );

    return reply.status(200).send({ collaborators });
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

  async updateDetails(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        specialty: z.string().trim().min(1).max(120).optional(),
        commissionPercentage: z.number().min(0).max(100).optional(),
      })
      .refine((data) => Object.keys(data).length > 0, {
        message: "At least one field must be provided.",
      })
      .parse(request.body);

    const repo = this.deps.collaboratorsRepository;
    if (!repo?.updateDetailsInCompany) {
      return reply.status(501).send({ message: "Collaborator update is not supported." });
    }

    const patch: {
      name?: string;
      specialty?: string;
      commissionPercentage?: number;
    } = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.specialty !== undefined) patch.specialty = body.specialty;
    if (body.commissionPercentage !== undefined) {
      patch.commissionPercentage = body.commissionPercentage;
    }

    const updated = await repo.updateDetailsInCompany(
      collaboratorId,
      request.actor.companyId,
      patch,
    );

    if (!updated) {
      return reply.status(404).send({ message: "Collaborator not found." });
    }

    return reply.status(200).send({ ...updated, role: "COLLABORATOR" as const });
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const bodySchema = z
      .object({
        transferToCollaboratorId: z.string().uuid().optional(),
      })
      .optional();
    const querySchema = z
      .object({
        transferToCollaboratorId: z.string().uuid().optional(),
      })
      .optional();

    const parsedBody = bodySchema.safeParse(request.body);
    const parsedQuery = querySchema.safeParse(request.query);
    const transferToCollaboratorId =
      (parsedBody.success ? parsedBody.data?.transferToCollaboratorId : undefined) ??
      (parsedQuery.success ? parsedQuery.data?.transferToCollaboratorId : undefined);

    const repo = this.deps.collaboratorsRepository;
    if (!repo?.deleteInCompany) {
      return reply.status(501).send({ message: "Collaborator deletion is not supported." });
    }

    const result = await repo.deleteInCompany(
      collaboratorId,
      request.actor.companyId,
      transferToCollaboratorId,
    );

    if (result === "not_found") {
      return reply.status(404).send({ message: "Collaborator not found." });
    }
    if (result === "destination_not_found") {
      return reply.status(400).send({
        message: "Destination collaborator for appointment transfer was not found or is inactive.",
      });
    }
    if (result === "has_appointments") {
      return reply.status(409).send({
        message:
          "Cannot delete a collaborator with linked appointments without transferring them.",
        hasAppointments: true,
      });
    }

    return reply.status(204).send();
  }
}
