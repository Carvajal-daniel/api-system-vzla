import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { Client } from "../../../domain/entities/client.entity.js";
import {
  ClientNotFoundError,
  ClientPhoneAlreadyExistsError,
} from "../../../domain/errors/client-errors.js";
import type { ClientsRepository } from "../../../domain/repositories/clients.repository.js";
import { ClientTable } from "../schema/clients-schema.js";

function mapRowToClient(row: typeof ClientTable.$inferSelect): Client {
  return Client.restore({
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    birthDate: row.birthDate,
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes,
    lastVisitAt: row.lastVisitAt,
    totalSpentCents: Number(row.totalSpentCents ?? 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: string; cause?: { code?: string } };
  return record.code === "23505" || record.cause?.code === "23505";
}

export class DrizzleClientsRepository implements ClientsRepository {
  async listByCompany(companyId: string, search?: string): Promise<Client[]> {
    const trimmedSearch = search?.trim();
    const whereClause = trimmedSearch
      ? and(
          eq(ClientTable.companyId, companyId),
          or(
            ilike(ClientTable.name, `%${trimmedSearch}%`),
            ilike(ClientTable.phone, `%${trimmedSearch}%`),
          ),
        )
      : eq(ClientTable.companyId, companyId);

    const rows = await db
      .select()
      .from(ClientTable)
      .where(whereClause)
      .orderBy(asc(ClientTable.name));

    return rows.map(mapRowToClient);
  }

  async findById(companyId: string, id: string): Promise<Client | null> {
    const [row] = await db
      .select()
      .from(ClientTable)
      .where(and(eq(ClientTable.companyId, companyId), eq(ClientTable.id, id)))
      .limit(1);

    return row ? mapRowToClient(row) : null;
  }

  async findByPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<Client | null> {
    const [row] = await db
      .select()
      .from(ClientTable)
      .where(
        and(
          eq(ClientTable.companyId, companyId),
          eq(ClientTable.phone, normalizedPhone),
        ),
      )
      .limit(1);

    return row ? mapRowToClient(row) : null;
  }

  async create(client: Client): Promise<Client> {
    const data = client.toPersistence();
    try {
      const [row] = await db.insert(ClientTable).values(data).returning();
      return mapRowToClient(row!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ClientPhoneAlreadyExistsError();
      }
      throw error;
    }
  }

  async update(client: Client): Promise<Client> {
    const data = client.toPersistence();
    try {
      const [row] = await db
        .update(ClientTable)
        .set({
          name: data.name,
          phone: data.phone,
          email: data.email,
          birthDate: data.birthDate,
          tags: data.tags,
          notes: data.notes,
          updatedAt: data.updatedAt,
        })
        .where(
          and(
            eq(ClientTable.companyId, data.companyId),
            eq(ClientTable.id, data.id),
          ),
        )
        .returning();

      if (!row) {
        throw new ClientNotFoundError();
      }

      return mapRowToClient(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ClientPhoneAlreadyExistsError();
      }
      throw error;
    }
  }
}
