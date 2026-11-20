import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateServiceUseCase } from "../../../application/use-cases/create-service.use-case.js";
import type { ListCompanyServicesUseCase } from "../../../application/use-cases/list-company-services.use-case.js";
import type { UpdateServiceStatusUseCase } from "../../../application/use-cases/update-service-status.use-case.js";
import type { UpdateServiceUseCase } from "../../../application/use-cases/update-service.use-case.js";
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
}
