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
        currency: CompanyTable.currency,
        isActive: CompanyTable.isActive,
        avatarUrl: CompanyTable.avatarUrl,
        operatingDays: CompanyTable.operatingDays,
        operatingSchedule: CompanyTable.operatingSchedule,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      companyName: row.companyName,
      timezone: row.timezone,
      currency: row.currency,
      isActive: row.isActive,
      avatarUrl: row.avatarUrl,
      operatingDays: row.operatingDays,
      operatingSchedule: (row.operatingSchedule as PublicCompanySummary["operatingSchedule"]) ?? null,
    };
  }
}
