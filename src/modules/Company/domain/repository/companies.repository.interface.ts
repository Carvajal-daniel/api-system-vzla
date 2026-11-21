import type { CompanyEntity } from "../entities/company.entity.js";


export interface CompaniesRepository {
  existsByEmail(email: string): Promise<boolean>;
  save(company: CompanyEntity, passwordHash: string): Promise<void>;
  updateTimezone(companyId: string, timezone: string): Promise<boolean>;
}
