import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { UnauthorizedWorkScheduleActionError } from "../../domain/errors/work-schedule-errors.js";
import type { WorkSchedulesRepository } from "../../domain/repositories/work-schedules.repository.js";
import {
  type WorkScheduleOutputDTO,
  toWorkScheduleOutputDTO,
} from "../dtos/work-schedule.dtos.js";

export class ListOwnWorkSchedulesUseCase {
  constructor(private readonly workSchedulesRepository: WorkSchedulesRepository) {}

  async execute(actor: ActorContext): Promise<WorkScheduleOutputDTO[]> {
    if (actor.role !== "COLLABORATOR") {
      throw new UnauthorizedWorkScheduleActionError(
        "Only collaborators can access their own work schedules.",
      );
    }

    const schedules = await this.workSchedulesRepository.findByCollaboratorInCompany(
      actor.collaboratorId,
      actor.companyId,
    );

    return schedules.map(toWorkScheduleOutputDTO);
  }
}
