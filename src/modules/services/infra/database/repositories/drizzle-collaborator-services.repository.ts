import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorServiceEntity } from "../../../domain/entities/collaborator-service.entity.js";
import { CollaboratorServiceAlreadyExistsError } from "../../../domain/errors/service-errors.js";
import type { CollaboratorServicesRepository } from "../../../domain/repositories/collaborator-services.repository.js";
import { CollaboratorServiceTable } from "../schema/collaborator-services-schema.js";

type CollaboratorServiceRow = typeof CollaboratorServiceTable.$inferSelect;

function isPgUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const record = error as { code?: unknown; cause?: unknown };
  if (record.code === "23505") {
    return true;
  }

  if (typeof record.cause === "object" && record.cause !== null) {
    const cause = record.cause as { code?: unknown };
    return cause.code === "23505";
  }

  return false;
}

function toDomain(row: CollaboratorServiceRow): CollaboratorServiceEntity {
  return CollaboratorServiceEntity.restore({
    id: row.id,
    companyId: row.companyId,
    collaboratorId: row.collaboratorId,
    serviceId: row.serviceId,
    commissionPercentage: row.commissionPercentage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleCollaboratorServicesRepository implements CollaboratorServicesRepository {
  async findByCollaboratorAndServiceInCompany(
    collaboratorId: string,
    serviceId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity | null> {
    const rows = await db
      .select()
      .from(CollaboratorServiceTable)
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
          eq(CollaboratorServiceTable.serviceId, serviceId),
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findAllByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]> {
    const rows = await db
      .select()
      .from(CollaboratorServiceTable)
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
        ),
      );

    return rows.map(toDomain);
  }

  async findAllByServiceIdsInCompany(
    serviceIds: string[],
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]> {
    if (serviceIds.length === 0) {
      return [];
    }

    const rows = await db
      .select()
      .from(CollaboratorServiceTable)
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          inArray(CollaboratorServiceTable.serviceId, serviceIds),
        ),
      );

    return rows.map(toDomain);
  }

  async create(link: CollaboratorServiceEntity): Promise<void> {
    try {
      await db.insert(CollaboratorServiceTable).values({
        id: link.id,
        companyId: link.companyId,
        collaboratorId: link.collaboratorId,
        serviceId: link.serviceId,
        commissionPercentage: link.commissionPercentage,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new CollaboratorServiceAlreadyExistsError();
      }
      throw error;
    }
  }

  async save(link: CollaboratorServiceEntity): Promise<void> {
    await db
      .update(CollaboratorServiceTable)
      .set({
        commissionPercentage: link.commissionPercentage,
        updatedAt: link.updatedAt,
      })
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, link.companyId),
          eq(CollaboratorServiceTable.collaboratorId, link.collaboratorId),
          eq(CollaboratorServiceTable.serviceId, link.serviceId),
        ),
      );
  }

  async delete(collaboratorId: string, serviceId: string, companyId: string): Promise<void> {
    await db
      .delete(CollaboratorServiceTable)
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
          eq(CollaboratorServiceTable.serviceId, serviceId),
        ),
      );
  }
}
