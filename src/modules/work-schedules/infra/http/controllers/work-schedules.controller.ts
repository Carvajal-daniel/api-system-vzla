import type { FastifyReply, FastifyRequest } from "fastify";
import type { ListCollaboratorWorkSchedulesUseCase } from "../../../application/use-cases/list-collaborator-work-schedules.use-case.js";
import type { ListOwnWorkSchedulesUseCase } from "../../../application/use-cases/list-own-work-schedules.use-case.js";
import type { UpsertCollaboratorWorkSchedulesUseCase } from "../../../application/use-cases/upsert-collaborator-work-schedules.use-case.js";
import {
  collaboratorIdParamSchema,
  upsertWorkSchedulesBodySchema,
} from "../schemas/work-schedule-http.schemas.js";

export interface WorkSchedulesControllerDeps {
  upsertCollaboratorWorkSchedulesUseCase: UpsertCollaboratorWorkSchedulesUseCase;
  listCollaboratorWorkSchedulesUseCase: ListCollaboratorWorkSchedulesUseCase;
  listOwnWorkSchedulesUseCase: ListOwnWorkSchedulesUseCase;
}

export class WorkSchedulesController {
  constructor(private readonly deps: WorkSchedulesControllerDeps) {}

  async upsert(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const { schedules } = upsertWorkSchedulesBodySchema.parse(request.body);

    const saved = await this.deps.upsertCollaboratorWorkSchedulesUseCase.execute(request.actor, {
      collaboratorId,
      schedules,
    });

    return reply.status(200).send({ schedules: saved });
  }

  async listByCollaborator(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { collaboratorId } = collaboratorIdParamSchema.parse(request.params);
    const schedules = await this.deps.listCollaboratorWorkSchedulesUseCase.execute(
      request.actor,
      collaboratorId,
    );

    return reply.status(200).send({ schedules });
  }

  async listOwn(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const schedules = await this.deps.listOwnWorkSchedulesUseCase.execute(request.actor);

    return reply.status(200).send({ schedules });
  }
}
