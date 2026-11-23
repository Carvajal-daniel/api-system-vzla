import type { CompanyOperatingDaySchedule } from "../../../appointments/domain/repositories/scheduling-context-lookup.repository.js";
export interface PublicCompanySummary {
  id: string;
  companyName: string;
  timezone: string;
  currency?: "BRL" | "USD" | "VES";
  isActive: boolean;
  avatarUrl?: string | null | undefined;
  operatingDays?: string | null | undefined;
  operatingSchedule?: CompanyOperatingDaySchedule[] | null | undefined;
}

export interface CompanyLookupRepository {
  findById(companyId: string): Promise<PublicCompanySummary | null>;
}
