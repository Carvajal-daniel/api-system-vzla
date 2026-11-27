
import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";

import { CompanyTable } from "../schema/companies-schema.js";
import type { CompanyEntity } from "../../../domain/entities/company.entity.js";
import type { CompaniesRepository } from "../../../domain/repository/companies.repository.interface.js";

export class CompanyRepositoryDB implements CompaniesRepository {
  
  async save(company: CompanyEntity, passwordHash: string): Promise<void> {
    await db
      .insert(CompanyTable)
      .values({
        id: company.id,
        companyName: company.companyName,
        slug: company.slug,
        name: company.name,
        phone: company.phone,
        email: company.email,
        password: passwordHash,
        isActive: company.isActive,
        timezone: company.timezone,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
      });
  }

  async existsByEmail(email: string): Promise<boolean> {

    const result = await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.email, email))
      .limit(1);

    return result.length > 0;
  }

  async updateTimezone(companyId: string, timezone: string): Promise<boolean> {
    const updated = await db
      .update(CompanyTable)
      .set({ timezone, updatedAt: new Date() })
      .where(eq(CompanyTable.id, companyId))
      .returning({ id: CompanyTable.id });

    return updated.length > 0;
  }
}
