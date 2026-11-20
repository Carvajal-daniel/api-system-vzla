import { and, asc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { ScheduleBlock } from "../../../domain/entities/schedule-block.entity.js";
import type {
  ListScheduleBlocksFilter,
  ScheduleBlocksRepository,
} from "../../../domain/repositories/schedule-blocks.repository.js";
import { ScheduleBlockTable } from "../schema/schedule-blocks-schema.js";

function mapRowToEntity(
  row: typeof ScheduleBlockTable.$inferSelect,
): ScheduleBlock {
  return ScheduleBlock.restore({
    id: row.id,
    companyId: row.companyId,
    collaboratorId: row.collaboratorId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleScheduleBlocksRepository
  implements ScheduleBlocksRepository
{
  async create(block: ScheduleBlock): Promise<void> {
    await db.insert(ScheduleBlockTable).values({
      id: block.id,
      companyId: block.companyId,
      collaboratorId: block.collaboratorId,
      startsAt: block.startsAt,
      endsAt: block.endsAt,
      reason: block.reason,
      createdAt: block.createdAt,
      updatedAt: block.updatedAt,
    });
  }

  async findById(
    companyId: string,
    blockId: string,
  ): Promise<ScheduleBlock | null> {
    const rows = await db
      .select()
      .from(ScheduleBlockTable)
      .where(
        and(
          eq(ScheduleBlockTable.companyId, companyId),
          eq(ScheduleBlockTable.id, blockId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? mapRowToEntity(row) : null;
  }

  async list(filter: ListScheduleBlocksFilter): Promise<ScheduleBlock[]> {
    const conditions = [eq(ScheduleBlockTable.companyId, filter.companyId)];

    if (filter.collaboratorId !== undefined) {
      conditions.push(
        eq(ScheduleBlockTable.collaboratorId, filter.collaboratorId),
      );
    }
    if (filter.from !== undefined) {
      conditions.push(gt(ScheduleBlockTable.endsAt, filter.from));
    }
    if (filter.to !== undefined) {
      conditions.push(lt(ScheduleBlockTable.startsAt, filter.to));
    }

    const rows = await db
      .select()
      .from(ScheduleBlockTable)
      .where(and(...conditions))
      .orderBy(asc(ScheduleBlockTable.startsAt));

    return rows.map(mapRowToEntity);
  }

  async findOverlappingForCollaborator(
    companyId: string,
    collaboratorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduleBlock[]> {
    const rows = await db
      .select()
      .from(ScheduleBlockTable)
      .where(
        and(
          eq(ScheduleBlockTable.companyId, companyId),
          or(
            isNull(ScheduleBlockTable.collaboratorId),
            eq(ScheduleBlockTable.collaboratorId, collaboratorId),
          ),
          lt(ScheduleBlockTable.startsAt, rangeEnd),
          gt(ScheduleBlockTable.endsAt, rangeStart),
        ),
      )
      .orderBy(asc(ScheduleBlockTable.startsAt));

    return rows.map(mapRowToEntity);
  }

  async delete(companyId: string, blockId: string): Promise<boolean> {
    const deleted = await db
      .delete(ScheduleBlockTable)
      .where(
        and(
          eq(ScheduleBlockTable.companyId, companyId),
          eq(ScheduleBlockTable.id, blockId),
        ),
      )
      .returning({ id: ScheduleBlockTable.id });

    return deleted.length > 0;
  }
}
