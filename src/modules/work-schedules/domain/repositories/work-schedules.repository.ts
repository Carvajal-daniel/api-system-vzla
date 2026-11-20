import type { WorkScheduleEntity } from "../entities/work-schedule.entity.js";

export interface WorkSchedulesRepository {
  findByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<WorkScheduleEntity[]>;
  upsertMany(
    companyId: string,
    collaboratorId: string,
    schedules: WorkScheduleEntity[],
  ): Promise<WorkScheduleEntity[]>;
}
