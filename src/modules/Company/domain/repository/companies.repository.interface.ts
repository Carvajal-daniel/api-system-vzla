import type { CompanyEntity } from "../entities/company.entity.js";
import type { CompanyEmail } from "../value-objects/company-email.vo.js";


export interface CompaniesRepository {
  existsByEmail(email: string): Promise<boolean>;
  save(company: CompanyEntity, passwordHash: string): Promise<void>;
}
