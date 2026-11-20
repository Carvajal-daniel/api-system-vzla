import {
  ScheduleBlockNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { DeleteScheduleBlockInputDTO } from "../dtos/schedule-block.dtos.js";

export class DeleteScheduleBlockUseCase {
  constructor(
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
  ) {}

  async execute(input: DeleteScheduleBlockInputDTO): Promise<void> {
    const { actor, blockId } = input;

    const existing = await this.scheduleBlocksRepository.findById(
      actor.companyId,
      blockId,
    );

    if (!existing) {
      throw new ScheduleBlockNotFoundError();
    }

    if (
      actor.role === "COLLABORATOR" &&
      existing.collaboratorId !== actor.collaboratorId
    ) {
      throw new UnauthorizedSchedulingActionError();
    }

    await this.scheduleBlocksRepository.delete(actor.companyId, blockId);
  }
}
