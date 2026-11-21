import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { WorkScheduleEntity } from "../../domain/entities/work-schedule.entity.js";
import {
  DuplicateWorkScheduleDayError,
  InvalidDayOfWeekError,
  UnauthorizedWorkScheduleActionError,
  WorkScheduleCollaboratorNotFoundError,
} from "../../domain/errors/work-schedule-errors.js";
import type { WorkScheduleCollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { WorkSchedulesRepository } from "../../domain/repositories/work-schedules.repository.js";
import {
  type UpsertCollaboratorWorkSchedulesInputDTO,
  type WorkScheduleOutputDTO,
  toWorkScheduleOutputDTO,
} from "../dtos/work-schedule.dtos.js";

export class UpsertCollaboratorWorkSchedulesUseCase {
  constructor(
    private readonly collaboratorLookupRepository: WorkScheduleCollaboratorLookupRepository,
    private readonly workSchedulesRepository: WorkSchedulesRepository,
  ) {}

  async execute(
    actor: ActorContext,
    input: UpsertCollaboratorWorkSchedulesInputDTO,
  ): Promise<WorkScheduleOutputDTO[]> {
    // Permite OWNER configurar qualquer colaborador da empresa ou COLLABORATOR editar apenas sua própria grade
    const isOwner = actor.role === "OWNER";
    const isOwnCollaborator =
      actor.role === "COLLABORATOR" &&
      actor.collaboratorId === input.collaboratorId;

    if (!isOwner && !isOwnCollaborator) {
      throw new UnauthorizedWorkScheduleActionError();
    }

    if (input.schedules.length === 0 || input.schedules.length > 7) {
      throw new InvalidDayOfWeekError("Schedules must contain between 1 and 7 day entries.");
    }

    const seenDays = new Set<number>();
    const entities: WorkScheduleEntity[] = [];

    for (const dayInput of input.schedules) {
      const entity = WorkScheduleEntity.create({
        companyId: actor.companyId,
        collaboratorId: input.collaboratorId,
        dayOfWeek: dayInput.dayOfWeek,
        isWorkingDay: dayInput.isWorkingDay,
        startTime: dayInput.startTime,
        endTime: dayInput.endTime,
        breakStart: dayInput.breakStart,
        breakEnd: dayInput.breakEnd,
      });

      if (seenDays.has(entity.dayOfWeek)) {
        throw new DuplicateWorkScheduleDayError();
      }
      seenDays.add(entity.dayOfWeek);
      entities.push(entity);
    }

    const collaboratorExists = await this.collaboratorLookupRepository.existsInCompany(
      input.collaboratorId,
      actor.companyId,
    );

    if (!collaboratorExists) {
      throw new WorkScheduleCollaboratorNotFoundError();
    }

    const saved = await this.workSchedulesRepository.upsertMany(
      actor.companyId,
      input.collaboratorId,
      entities,
    );

    return saved.map(toWorkScheduleOutputDTO);
  }
}
