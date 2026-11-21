import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
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
    imageUrl: row.imageUrl,
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
        imageUrl: service.imageUrl,
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
          imageUrl: service.imageUrl,
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

  async deleteInCompany(
    id: string,
    companyId: string,
  ): Promise<"deleted" | "not_found" | "has_appointments"> {
    // Bloqueia exclusão física de serviços que possuam agendamentos vinculados para manter o histórico intacto.
    const linked = await db
      .select({ id: AppointmentTable.id })
      .from(AppointmentTable)
      .where(
        and(
          eq(AppointmentTable.companyId, companyId),
          eq(AppointmentTable.serviceId, id),
        ),
      )
      .limit(1);

    if (linked.length > 0) {
      return "has_appointments";
    }

    try {
      const deleted = await db
        .delete(ServiceTable)
        .where(and(eq(ServiceTable.id, id), eq(ServiceTable.companyId, companyId)))
        .returning({ id: ServiceTable.id });

      return deleted.length > 0 ? "deleted" : "not_found";
    } catch (error) {
      const candidate = error as { code?: unknown; cause?: { code?: unknown } };
      if (candidate?.code === "23503" || candidate?.cause?.code === "23503") {
        return "has_appointments";
      }
      throw error;
    }
  }
}
