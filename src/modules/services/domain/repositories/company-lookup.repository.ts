export interface PublicCompanySummary {
  id: string;
  companyName: string;
  timezone: string;
  isActive: boolean;
}

export interface CompanyLookupRepository {
  findById(companyId: string): Promise<PublicCompanySummary | null>;
}
