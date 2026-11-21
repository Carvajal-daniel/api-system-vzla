import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateServiceUseCase } from "../../../application/use-cases/create-service.use-case.js";
import type { ListCompanyServicesUseCase } from "../../../application/use-cases/list-company-services.use-case.js";
import type { UpdateServiceStatusUseCase } from "../../../application/use-cases/update-service-status.use-case.js";
import type { UpdateServiceUseCase } from "../../../application/use-cases/update-service.use-case.js";
import type { ServicesRepository } from "../../../domain/repositories/services.repository.js";
import {
  createServiceBodySchema,
  serviceIdParamSchema,
  updateServiceBodySchema,
  updateServiceStatusBodySchema,
} from "../schemas/service-http.schemas.js";

export interface ServicesControllerDeps {
  createServiceUseCase: CreateServiceUseCase;
  listCompanyServicesUseCase: ListCompanyServicesUseCase;
  updateServiceUseCase: UpdateServiceUseCase;
  updateServiceStatusUseCase: UpdateServiceStatusUseCase;
  servicesRepository?: ServicesRepository;
}

export class ServicesController {
  constructor(private readonly deps: ServicesControllerDeps) {}

  async create(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const body = createServiceBodySchema.parse(request.body);
    const service = await this.deps.createServiceUseCase.execute(request.actor, body);

    return reply.status(201).send(service);
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const services = await this.deps.listCompanyServicesUseCase.execute(request.actor);

    return reply.status(200).send({ services });
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId } = serviceIdParamSchema.parse(request.params);
    const body = updateServiceBodySchema.parse(request.body);
    const service = await this.deps.updateServiceUseCase.execute(request.actor, {
      serviceId,
      ...body,
    });

    return reply.status(200).send(service);
  }

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { serviceId } = serviceIdParamSchema.parse(request.params);
    const { active } = updateServiceStatusBodySchema.parse(request.body);
    const service = await this.deps.updateServiceStatusUseCase.execute(request.actor, {
      serviceId,
      active,
    });

    return reply.status(200).send(service);
  }

  async remove(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor || request.actor.role !== "OWNER") {
      return reply.status(403).send({ message: "You do not have permission to perform this action." });
    }

    const { serviceId } = serviceIdParamSchema.parse(request.params);
    const repo = this.deps.servicesRepository;
    if (!repo?.deleteInCompany) {
      return reply.status(501).send({ message: "Service deletion is not supported." });
    }

    const result = await repo.deleteInCompany(serviceId, request.actor.companyId);

    if (result === "not_found") {
      return reply.status(404).send({ message: "Service not found." });
    }
    if (result === "has_appointments") {
      return reply.status(409).send({
        message:
          "Cannot delete a service with linked appointments. Deactivate the service instead.",
      });
    }

    return reply.status(204).send();
  }
}
