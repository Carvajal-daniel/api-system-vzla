import { ListCollaboratorWorkSchedulesUseCase } from "../../../application/use-cases/list-collaborator-work-schedules.use-case.js";
import { ListOwnWorkSchedulesUseCase } from "../../../application/use-cases/list-own-work-schedules.use-case.js";
import { UpsertCollaboratorWorkSchedulesUseCase } from "../../../application/use-cases/upsert-collaborator-work-schedules.use-case.js";
import { DrizzleWorkScheduleCollaboratorLookupRepository } from "../../database/repositories/drizzle-collaborator-lookup.repository.js";
import { DrizzleWorkSchedulesRepository } from "../../database/repositories/drizzle-work-schedules.repository.js";
import { WorkSchedulesController } from "../controllers/work-schedules.controller.js";

export function makeWorkSchedulesController(): WorkSchedulesController {
  const collaboratorLookupRepository = new DrizzleWorkScheduleCollaboratorLookupRepository();
  const workSchedulesRepository = new DrizzleWorkSchedulesRepository();

  return new WorkSchedulesController({
    upsertCollaboratorWorkSchedulesUseCase: new UpsertCollaboratorWorkSchedulesUseCase(
      collaboratorLookupRepository,
      workSchedulesRepository,
    ),
    listCollaboratorWorkSchedulesUseCase: new ListCollaboratorWorkSchedulesUseCase(
      collaboratorLookupRepository,
      workSchedulesRepository,
    ),
    listOwnWorkSchedulesUseCase: new ListOwnWorkSchedulesUseCase(workSchedulesRepository),
  });
}
