import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { WorkScheduleEntity } from "../../../domain/entities/work-schedule.entity.js";
import type { WorkSchedulesRepository } from "../../../domain/repositories/work-schedules.repository.js";
import { WorkScheduleTable } from "../schema/work-schedules-schema.js";

type WorkScheduleRow = typeof WorkScheduleTable.$inferSelect;

function toDomain(row: WorkScheduleRow): WorkScheduleEntity {
  return WorkScheduleEntity.restore({
    id: row.id,
    companyId: row.companyId,
    collaboratorId: row.collaboratorId,
    dayOfWeek: row.dayOfWeek,
    isWorkingDay: row.isWorkingDay,
    startTime: row.startTime,
    endTime: row.endTime,
    breakStart: row.breakStart,
    breakEnd: row.breakEnd,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleWorkSchedulesRepository implements WorkSchedulesRepository {
  async findByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<WorkScheduleEntity[]> {
    const rows = await db
      .select()
      .from(WorkScheduleTable)
      .where(
        and(
          eq(WorkScheduleTable.companyId, companyId),
          eq(WorkScheduleTable.collaboratorId, collaboratorId),
        ),
      )
      .orderBy(asc(WorkScheduleTable.dayOfWeek));

    return rows.map(toDomain);
  }

  async upsertMany(
    companyId: string,
    collaboratorId: string,
    schedules: WorkScheduleEntity[],
  ): Promise<WorkScheduleEntity[]> {
    await db.transaction(async (tx) => {
      for (const schedule of schedules) {
        await tx
          .insert(WorkScheduleTable)
          .values({
            id: schedule.id,
            companyId,
            collaboratorId,
            dayOfWeek: schedule.dayOfWeek,
            isWorkingDay: schedule.isWorkingDay,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
            breakStart: schedule.breakStart,
            breakEnd: schedule.breakEnd,
            createdAt: schedule.createdAt,
            updatedAt: schedule.updatedAt,
          })
          .onConflictDoUpdate({
            target: [
              WorkScheduleTable.companyId,
              WorkScheduleTable.collaboratorId,
              WorkScheduleTable.dayOfWeek,
            ],
            set: {
              isWorkingDay: schedule.isWorkingDay,
              startTime: schedule.startTime,
              endTime: schedule.endTime,
              breakStart: schedule.breakStart,
              breakEnd: schedule.breakEnd,
              updatedAt: schedule.updatedAt,
            },
          });
      }
    });

    return this.findByCollaboratorInCompany(collaboratorId, companyId);
  }
}
