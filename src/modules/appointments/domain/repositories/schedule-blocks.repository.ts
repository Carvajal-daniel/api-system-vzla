import type { ScheduleBlock } from "../entities/schedule-block.entity.js";

export interface ListScheduleBlocksFilter {
  companyId: string;
  collaboratorId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface ScheduleBlocksRepository {
  create(block: ScheduleBlock): Promise<void>;
  findById(companyId: string, blockId: string): Promise<ScheduleBlock | null>;
  list(filter: ListScheduleBlocksFilter): Promise<ScheduleBlock[]>;
  /**
   * Retorna bloqueios que intersectam [rangeStart, rangeEnd) aplicáveis ao colaborador
   * (tanto bloqueios individuais quanto bloqueios globais da empresa com collaboratorId = null).
   */
  findOverlappingForCollaborator(
    companyId: string,
    collaboratorId: string,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduleBlock[]>;
  delete(companyId: string, blockId: string): Promise<boolean>;
}
