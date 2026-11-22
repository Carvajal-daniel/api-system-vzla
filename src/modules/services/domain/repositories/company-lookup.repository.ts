export interface PublicCompanySummary {
  id: string;
  companyName: string;
  timezone: string;
  currency?: "BRL" | "USD" | "VES";
  isActive: boolean;
  avatarUrl?: string | null | undefined;
  operatingDays?: string | null | undefined;
  operatingSchedule?: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    openTime: string | null;
    closeTime: string | null;
  }> | null | undefined;
}

export interface CompanyLookupRepository {
  findById(companyId: string): Promise<PublicCompanySummary | null>;
}
