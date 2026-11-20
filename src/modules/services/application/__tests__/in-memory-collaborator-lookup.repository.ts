import type {
  CollaboratorLookupRepository,
  CollaboratorSummary,
} from "../../domain/repositories/collaborator-lookup.repository.js";

export class InMemoryCollaboratorLookupRepository implements CollaboratorLookupRepository {
  public readonly items: CollaboratorSummary[] = [];

  async findByIdInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorSummary | null> {
    const found = this.items.find(
      (item) => item.id === collaboratorId && item.companyId === companyId,
    );
    return found ? { ...found } : null;
  }

  async findActiveByIdsInCompany(
    collaboratorIds: string[],
    companyId: string,
  ): Promise<CollaboratorSummary[]> {
    const idSet = new Set(collaboratorIds);
    return this.items
      .filter((item) => item.companyId === companyId && item.isActive && idSet.has(item.id))
      .map((item) => ({ ...item }));
  }
}
