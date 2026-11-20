import { and, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import type { WorkScheduleCollaboratorLookupRepository } from "../../../domain/repositories/collaborator-lookup.repository.js";

export class DrizzleWorkScheduleCollaboratorLookupRepository
  implements WorkScheduleCollaboratorLookupRepository
{
  async existsInCompany(collaboratorId: string, companyId: string): Promise<boolean> {
    const rows = await db
      .select({ id: CollaboratorTable.id })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    return rows.length > 0;
  }
}
