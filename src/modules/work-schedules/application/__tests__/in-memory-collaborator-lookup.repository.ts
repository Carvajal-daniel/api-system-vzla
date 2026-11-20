import type { WorkScheduleCollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";

export interface WorkScheduleCollaboratorRecord {
  id: string;
  companyId: string;
}

export class InMemoryWorkScheduleCollaboratorLookupRepository
  implements WorkScheduleCollaboratorLookupRepository
{
  public readonly items: WorkScheduleCollaboratorRecord[] = [];

  async existsInCompany(collaboratorId: string, companyId: string): Promise<boolean> {
    return this.items.some(
      (item) => item.id === collaboratorId && item.companyId === companyId,
    );
  }
}
