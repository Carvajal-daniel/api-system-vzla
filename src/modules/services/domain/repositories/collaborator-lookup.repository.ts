export interface CollaboratorSummary {
  id: string;
  companyId: string;
  name: string;
  specialty: string;
  isActive: boolean;
  avatarUrl?: string | null;
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
  findAllActiveInCompany(companyId: string): Promise<CollaboratorSummary[]>;
}
