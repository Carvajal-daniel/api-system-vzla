export interface CollaboratorSummary {
  id: string;
  companyId: string;
  name: string;
  specialty: string;
  isActive: boolean;
}

export interface CollaboratorLookupRepository {
  findByIdInCompany(collaboratorId: string, companyId: string): Promise<CollaboratorSummary | null>;
  findByIdsInCompany(
    collaboratorIds: string[],
    companyId: string,
  ): Promise<CollaboratorSummary[]>;
  findActiveByIdsInCompany(
    collaboratorIds: string[],
    companyId: string,
  ): Promise<CollaboratorSummary[]>;
}
