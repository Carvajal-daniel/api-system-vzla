export interface WorkScheduleCollaboratorLookupRepository {
  existsInCompany(collaboratorId: string, companyId: string): Promise<boolean>;
}
