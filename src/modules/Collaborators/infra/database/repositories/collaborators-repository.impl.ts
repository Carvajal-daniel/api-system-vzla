import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import type { CollaboratorEntity } from "../../../domain/entities/collaborator.entity.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import { CollaboratorTable } from "../schema/collaborators-schema.js";

export class CollaboratorRepositoryDB implements CollaboratorsRepository {
  async existsByEmail(email: string): Promise<boolean> {
    const result = await db
      .select({ id: CollaboratorTable.id })
      .from(CollaboratorTable)
      .where(eq(CollaboratorTable.email, email))
      .limit(1);

    return result.length > 0;
  }

  async companyExistsById(companyId: string): Promise<boolean> {
    const result = await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return result.length > 0;
  }

  async save(collaborator: CollaboratorEntity): Promise<void> {
    await db.insert(CollaboratorTable).values({
      id: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      password: collaborator.password,
      phone: collaborator.phone,
      companyId: collaborator.companyId,
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
    });
  }
}
