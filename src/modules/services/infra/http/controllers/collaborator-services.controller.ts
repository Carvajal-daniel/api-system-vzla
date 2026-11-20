import type { FastifyReply, FastifyRequest } from "fastify";
import type { LinkCollaboratorToServiceUseCase } from "../../../application/use-cases/link-collaborator-to-service.use-case.js";
import type { ListCollaboratorAssignedServicesUseCase } from "../../../application/use-cases/list-collaborator-assigned-services.use-case.js";
import type { ListServiceCollaboratorsUseCase } from "../../../application/use-cases/list-service-collaborators.use-case.js";
import type { UnlinkCollaboratorFromServiceUseCase } from "../../../application/use-cases/unlink-collaborator-from-service.use-case.js";
import type { UpdateCollaboratorServiceCommissionUseCase } from "../../../application/use-cases/update-collaborator-service-commission.use-case.js";
import {
  linkCollaboratorServiceBodySchema,
  serviceCollaboratorParamsSchema,
  serviceIdParamSchema,
  updateCommissionBodySchema,
} from "../schemas/service-http.schemas.js";

export interface CollaboratorServicesControllerDeps {
  linkCollaboratorToServiceUseCase: LinkCollaboratorToServiceUseCase;
  updateCollaboratorServiceCommissionUseCase: UpdateCollaboratorServiceCommissionUseCase;
  unlinkCollaboratorFromServiceUseCase: UnlinkCollaboratorFromServiceUseCase;
  listCollaboratorAssignedServicesUseCase: ListCollaboratorAssignedServicesUseCase;
  listServiceCollaboratorsUseCase: ListServiceCollaboratorsUseCase;
}

export class CollaboratorServicesController {
  constructor(private readonly deps: CollaboratorServicesControllerDeps) {}

  async link(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId } = serviceIdParamSchema.parse(request.params);
    const body = linkCollaboratorServiceBodySchema.parse(request.body);
    const link = await this.deps.linkCollaboratorToServiceUseCase.execute(request.actor, {
      serviceId,
      collaboratorId: body.collaboratorId,
      commissionPercentage: body.commissionPercentage,
    });

    return reply.status(201).send(link);
  }

  async updateCommission(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId, collaboratorId } = serviceCollaboratorParamsSchema.parse(request.params);
    const { commissionPercentage } = updateCommissionBodySchema.parse(request.body);
    const link = await this.deps.updateCollaboratorServiceCommissionUseCase.execute(
      request.actor,
      {
        serviceId,
        collaboratorId,
        commissionPercentage,
      },
    );

    return reply.status(200).send(link);
  }

  async unlink(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId, collaboratorId } = serviceCollaboratorParamsSchema.parse(request.params);
    await this.deps.unlinkCollaboratorFromServiceUseCase.execute(request.actor, {
      serviceId,
      collaboratorId,
    });

    return reply.status(204).send();
  }

  async listOwnAssignedServices(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const services = await this.deps.listCollaboratorAssignedServicesUseCase.execute(request.actor);

    return reply.status(200).send({ services });
  }

  async listByService(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId } = serviceIdParamSchema.parse(request.params);
    const collaborators = await this.deps.listServiceCollaboratorsUseCase.execute(
      request.actor,
      serviceId,
    );

    return reply.status(200).send({ collaborators });
  }
}
