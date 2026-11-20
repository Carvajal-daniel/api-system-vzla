import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateScheduleBlockUseCase } from "../../../application/use-cases/create-schedule-block.use-case.js";
import type { DeleteScheduleBlockUseCase } from "../../../application/use-cases/delete-schedule-block.use-case.js";
import type { ListScheduleBlocksUseCase } from "../../../application/use-cases/list-schedule-blocks.use-case.js";
import {
  blockIdParamSchema,
  createCollaboratorScheduleBlockBodySchema,
  createOwnerScheduleBlockBodySchema,
  listOwnScheduleBlocksQuerySchema,
  listScheduleBlocksQuerySchema,
} from "../schemas/appointments-http.schemas.js";

export class ScheduleBlocksController {
  constructor(
    private readonly createScheduleBlockUseCase: CreateScheduleBlockUseCase,
    private readonly listScheduleBlocksUseCase: ListScheduleBlocksUseCase,
    private readonly deleteScheduleBlockUseCase: DeleteScheduleBlockUseCase,
  ) {}

  async createForOwner(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const body = createOwnerScheduleBlockBodySchema.parse(request.body);
    const result = await this.createScheduleBlockUseCase.execute({
      actor,
      collaboratorId: body.collaboratorId ?? null,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason ?? null,
    });

    return reply.status(201).send(result);
  }

  async createForCollaborator(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const body = createCollaboratorScheduleBlockBodySchema.parse(request.body);
    const result = await this.createScheduleBlockUseCase.execute({
      actor,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      reason: body.reason ?? null,
    });

    return reply.status(201).send(result);
  }

  async listForOwner(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const query = listScheduleBlocksQuerySchema.parse(request.query);
    const blocks = await this.listScheduleBlocksUseCase.execute({
      actor,
      collaboratorId: query.collaboratorId,
      from: query.from,
      to: query.to,
    });

    return reply.status(200).send(blocks);
  }

  async listForCollaborator(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const query = listOwnScheduleBlocksQuerySchema.parse(request.query);
    const blocks = await this.listScheduleBlocksUseCase.execute({
      actor,
      from: query.from,
      to: query.to,
    });

    return reply.status(200).send(blocks);
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { blockId } = blockIdParamSchema.parse(request.params);
    await this.deleteScheduleBlockUseCase.execute({ actor, blockId });

    return reply.status(204).send();
  }
}
