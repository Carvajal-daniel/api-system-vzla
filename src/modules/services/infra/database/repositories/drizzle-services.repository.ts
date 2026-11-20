import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { ServiceEntity } from "../../../domain/entities/service.entity.js";
import { ServiceNameAlreadyExistsError } from "../../../domain/errors/service-errors.js";
import type { ServicesRepository } from "../../../domain/repositories/services.repository.js";
import { ServiceTable } from "../schema/services-schema.js";

type ServiceRow = typeof ServiceTable.$inferSelect;

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

function toDomain(row: ServiceRow): ServiceEntity {
  return ServiceEntity.restore({
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    description: row.description,
    durationMinutes: row.durationMinutes,
    priceInCents: row.priceInCents,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export class DrizzleServicesRepository implements ServicesRepository {
  async findByIdInCompany(id: string, companyId: string): Promise<ServiceEntity | null> {
    const rows = await db
      .select()
      .from(ServiceTable)
      .where(and(eq(ServiceTable.id, id), eq(ServiceTable.companyId, companyId)))
      .limit(1);

    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findByNormalizedNameInCompany(
    normalizedName: string,
    companyId: string,
  ): Promise<ServiceEntity | null> {
    const rows = await db
      .select()
      .from(ServiceTable)
      .where(
        and(
          eq(ServiceTable.companyId, companyId),
          sql`lower(btrim(${ServiceTable.name})) = ${normalizedName}`,
        ),
      )
      .limit(1);

    const row = rows[0];
    return row ? toDomain(row) : null;
  }

  async findAllByCompany(companyId: string): Promise<ServiceEntity[]> {
    const rows = await db
      .select()
      .from(ServiceTable)
      .where(eq(ServiceTable.companyId, companyId))
      .orderBy(asc(ServiceTable.name));

    return rows.map(toDomain);
  }

  async findActiveByCompany(companyId: string): Promise<ServiceEntity[]> {
    const rows = await db
      .select()
      .from(ServiceTable)
      .where(and(eq(ServiceTable.companyId, companyId), eq(ServiceTable.active, true)))
      .orderBy(asc(ServiceTable.name));

    return rows.map(toDomain);
  }

  async create(service: ServiceEntity): Promise<void> {
    try {
      await db.insert(ServiceTable).values({
        id: service.id,
        companyId: service.companyId,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceInCents: service.priceInCents,
        active: service.active,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
      });
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ServiceNameAlreadyExistsError();
      }
      throw error;
    }
  }

  async save(service: ServiceEntity): Promise<void> {
    try {
      await db
        .update(ServiceTable)
        .set({
          name: service.name,
          description: service.description,
          durationMinutes: service.durationMinutes,
          priceInCents: service.priceInCents,
          active: service.active,
          updatedAt: service.updatedAt,
        })
        .where(
          and(eq(ServiceTable.id, service.id), eq(ServiceTable.companyId, service.companyId)),
        );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        throw new ServiceNameAlreadyExistsError();
      }
      throw error;
    }
  }
}
