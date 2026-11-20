import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import type {
  CompanyLookupRepository,
  PublicCompanySummary,
} from "../../../domain/repositories/company-lookup.repository.js";

export class DrizzleCompanyLookupRepository implements CompanyLookupRepository {
  async findById(companyId: string): Promise<PublicCompanySummary | null> {
    const rows = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        timezone: CompanyTable.timezone,
        isActive: CompanyTable.isActive,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return rows[0] ?? null;
  }
}
