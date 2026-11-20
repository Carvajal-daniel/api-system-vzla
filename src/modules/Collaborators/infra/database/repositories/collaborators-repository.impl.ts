import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorEmailAlreadyInError } from "../../../application/errors/collaborator-errors.js";
import type { CollaboratorEntity } from "../../../domain/entities/collaborator.entity.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import { CollaboratorTable } from "../schema/collaborators-schema.js";

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export class CollaboratorRepositoryDB implements CollaboratorsRepository {
  // Verifica unicidade global entre colaboradores e empresas para manter o login por e-mail sem ambiguidade.
  async existsByEmail(email: string): Promise<boolean> {
    const [collaboratorRow, companyRow] = await Promise.all([
      db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.email, email))
        .limit(1),
      db
        .select({ id: CompanyTable.id })
        .from(CompanyTable)
        .where(eq(CompanyTable.email, email))
        .limit(1),
    ]);

    return collaboratorRow.length > 0 || companyRow.length > 0;
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
    try {
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
    } catch (error) {
      // Protege contra condição de corrida quando dois cadastros usam o mesmo e-mail simultaneamente.
      if (isUniqueViolationError(error)) {
        throw new CollaboratorEmailAlreadyInError();
      }
      throw error;
    }
  }
}
