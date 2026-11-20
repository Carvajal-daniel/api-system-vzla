import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  UnauthorizedWorkScheduleActionError,
  WorkScheduleCollaboratorNotFoundError,
} from "../../domain/errors/work-schedule-errors.js";
import type { WorkScheduleCollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { WorkSchedulesRepository } from "../../domain/repositories/work-schedules.repository.js";
import {
  type WorkScheduleOutputDTO,
  toWorkScheduleOutputDTO,
} from "../dtos/work-schedule.dtos.js";

export class ListCollaboratorWorkSchedulesUseCase {
  constructor(
    private readonly collaboratorLookupRepository: WorkScheduleCollaboratorLookupRepository,
    private readonly workSchedulesRepository: WorkSchedulesRepository,
  ) {}

  async execute(actor: ActorContext, collaboratorId: string): Promise<WorkScheduleOutputDTO[]> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedWorkScheduleActionError();
    }

    const collaboratorExists = await this.collaboratorLookupRepository.existsInCompany(
      collaboratorId,
      actor.companyId,
    );

    if (!collaboratorExists) {
      throw new WorkScheduleCollaboratorNotFoundError();
    }

    const schedules = await this.workSchedulesRepository.findByCollaboratorInCompany(
      collaboratorId,
      actor.companyId,
    );

    return schedules.map(toWorkScheduleOutputDTO);
  }
}
