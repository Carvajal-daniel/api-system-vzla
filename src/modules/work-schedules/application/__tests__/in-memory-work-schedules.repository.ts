import { WorkScheduleEntity } from "../../domain/entities/work-schedule.entity.js";
import type { WorkSchedulesRepository } from "../../domain/repositories/work-schedules.repository.js";

export class InMemoryWorkSchedulesRepository implements WorkSchedulesRepository {
  public readonly items: WorkScheduleEntity[] = [];

  private clone(entity: WorkScheduleEntity): WorkScheduleEntity {
    return WorkScheduleEntity.restore({
      id: entity.id,
      companyId: entity.companyId,
      collaboratorId: entity.collaboratorId,
      dayOfWeek: entity.dayOfWeek,
      isWorkingDay: entity.isWorkingDay,
      startTime: entity.startTime,
      endTime: entity.endTime,
      breakStart: entity.breakStart,
      breakEnd: entity.breakEnd,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<WorkScheduleEntity[]> {
    return this.items
      .filter((item) => item.companyId === companyId && item.collaboratorId === collaboratorId)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((item) => this.clone(item));
  }

  async upsertMany(
    companyId: string,
    collaboratorId: string,
    schedules: WorkScheduleEntity[],
  ): Promise<WorkScheduleEntity[]> {
    for (const schedule of schedules) {
      const existingIndex = this.items.findIndex(
        (item) =>
          item.companyId === companyId &&
          item.collaboratorId === collaboratorId &&
          item.dayOfWeek === schedule.dayOfWeek,
      );

      if (existingIndex >= 0) {
        const existing = this.items[existingIndex]!;
        this.items[existingIndex] = WorkScheduleEntity.restore({
          id: existing.id,
          companyId,
          collaboratorId,
          dayOfWeek: schedule.dayOfWeek,
          isWorkingDay: schedule.isWorkingDay,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
          breakStart: schedule.breakStart,
          breakEnd: schedule.breakEnd,
          createdAt: existing.createdAt,
          updatedAt: schedule.updatedAt,
        });
      } else {
        this.items.push(this.clone(schedule));
      }
    }

    return this.findByCollaboratorInCompany(collaboratorId, companyId);
  }
}
