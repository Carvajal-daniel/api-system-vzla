import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListCompanyCollaboratorsUseCase } from "../../../application/list-company-collaborators.usecase.js";
import type { UpdateCollaboratorStatusUseCase } from "../../../application/update-collaborator-status.usecase.js";
import {
  collaboratorIdParamSchema,
  updateCollaboratorStatusBodySchema,
} from "../schemas/collaborator-http.schemas.js";

export interface CollaboratorsManagementControllerDeps {
  listCompanyCollaboratorsUseCase: ListCompanyCollaboratorsUseCase;
  updateCollaboratorStatusUseCase: UpdateCollaboratorStatusUseCase;
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
}
