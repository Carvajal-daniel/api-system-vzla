import type { ScheduleBlock } from "../../domain/entities/schedule-block.entity.js";
import type {
  ListScheduleBlocksFilter,
  ScheduleBlocksRepository,
} from "../../domain/repositories/schedule-blocks.repository.js";
import { TimeRange } from "../../domain/value-objects/time-range.vo.js";

export class InMemoryScheduleBlocksRepository implements ScheduleBlocksRepository {
  public readonly items: ScheduleBlock[] = [];

  async create(block: ScheduleBlock): Promise<void> {
    this.items.push(block);
  }

  async findById(
    companyId: string,
    blockId: string,
  ): Promise<ScheduleBlock | null> {
    return (
      this.items.find(
        (item) => item.companyId === companyId && item.id === blockId,
      ) ?? null
    );
  }

  async list(filter: ListScheduleBlocksFilter): Promise<ScheduleBlock[]> {
    return this.items
      .filter((item) => {
        if (item.companyId !== filter.companyId) return false;
        if (
          filter.collaboratorId !== undefined &&
          item.collaboratorId !== filter.collaboratorId
        ) {
          return false;
        }
        if (filter.from && item.endsAt.getTime() <= filter.from.getTime()) {
          return false;
        }
        if (filter.to && item.startsAt.getTime() >= filter.to.getTime()) {
          return false;
        }
        return true;
      })
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  }

  async findOverlappingForCollaborator(
    companyId: string,
    collaboratorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduleBlock[]> {
    const queryRange = TimeRange.create(rangeStart, rangeEnd);

    return this.items.filter((item) => {
      if (item.companyId !== companyId) return false;
      if (item.collaboratorId !== null && item.collaboratorId !== collaboratorId) {
        return false;
      }
      return item.toTimeRange().overlaps(queryRange);
    });
  }

  async delete(companyId: string, blockId: string): Promise<boolean> {
    const index = this.items.findIndex(
      (item) => item.companyId === companyId && item.id === blockId,
    );
    if (index === -1) return false;
    this.items.splice(index, 1);
    return true;
  }
}
