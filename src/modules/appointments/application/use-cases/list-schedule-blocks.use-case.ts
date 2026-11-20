import { UnauthorizedSchedulingActionError } from "../../domain/errors/appointment-errors.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import {
  type ListScheduleBlocksInputDTO,
  type ScheduleBlockOutputDTO,
  toScheduleBlockOutputDTO,
} from "../dtos/schedule-block.dtos.js";

export class ListScheduleBlocksUseCase {
  constructor(
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
  ) {}

  async execute(
    input: ListScheduleBlocksInputDTO,
  ): Promise<ScheduleBlockOutputDTO[]> {
    const { actor } = input;
    let collaboratorId = input.collaboratorId;

    if (actor.role === "COLLABORATOR") {
      if (
        collaboratorId !== undefined &&
        collaboratorId !== actor.collaboratorId
      ) {
        throw new UnauthorizedSchedulingActionError();
      }
      collaboratorId = actor.collaboratorId;
    }

    const blocks = await this.scheduleBlocksRepository.list({
      companyId: actor.companyId,
      collaboratorId,
      from: input.from,
      to: input.to,
    });

    return blocks.map(toScheduleBlockOutputDTO);
  }
}
