import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import type {
  CollaboratorLookupRepository,
  CollaboratorSummary,
} from "../../../domain/repositories/collaborator-lookup.repository.js";

export class DrizzleCollaboratorLookupRepository implements CollaboratorLookupRepository {
  async findByIdInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorSummary | null> {
    const rows = await db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        specialty: CollaboratorTable.specialty,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findByIdsInCompany(
    collaboratorIds: string[],
    companyId: string,
  ): Promise<CollaboratorSummary[]> {
    if (collaboratorIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        specialty: CollaboratorTable.specialty,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          inArray(CollaboratorTable.id, collaboratorIds),
        ),
      );
  }

  async findActiveByIdsInCompany(
    collaboratorIds: string[],
    companyId: string,
  ): Promise<CollaboratorSummary[]> {
    if (collaboratorIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        specialty: CollaboratorTable.specialty,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.isActive, true),
          inArray(CollaboratorTable.id, collaboratorIds),
        ),
      );
  }

  async findAllActiveInCompany(companyId: string): Promise<CollaboratorSummary[]> {
    return db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        specialty: CollaboratorTable.specialty,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.isActive, true),
        ),
      );
  }
}
