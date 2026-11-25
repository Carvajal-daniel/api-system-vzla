import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import type {
  TenantWhatsAppChannelProvider,
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
  UpsertTenantWhatsAppChannelInput,
} from "../../../domain/repositories/tenant-whatsapp-channels.repository.js";
import { TenantWhatsAppChannelsTable } from "../schema/tenant-whatsapp-channels-schema.js";

function mapChannelRow(
  row: typeof TenantWhatsAppChannelsTable.$inferSelect,
): TenantWhatsAppChannelRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    purpose: row.purpose,
    phoneNumber: row.phoneNumber,
    status: row.status,
    credentials: row.credentials ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Implementação Drizzle com filtro obrigatório por tenantId em toda leitura de canais.
export class DrizzleTenantWhatsAppChannelsRepository
  implements TenantWhatsAppChannelsRepository
{
  public async listByTenant(
    tenantId: string,
  ): Promise<TenantWhatsAppChannelRecord[]> {
    const rows = await db
      .select()
      .from(TenantWhatsAppChannelsTable)
      .where(eq(TenantWhatsAppChannelsTable.tenantId, tenantId))
      .orderBy(asc(TenantWhatsAppChannelsTable.createdAt));

    return rows.map(mapChannelRow);
  }

  public async listConnectedByTenant(
    tenantId: string,
  ): Promise<TenantWhatsAppChannelRecord[]> {
    const rows = await db
      .select()
      .from(TenantWhatsAppChannelsTable)
      .where(
        and(
          eq(TenantWhatsAppChannelsTable.tenantId, tenantId),
          eq(TenantWhatsAppChannelsTable.status, "CONNECTED"),
        ),
      )
      .orderBy(asc(TenantWhatsAppChannelsTable.createdAt));

    return rows.map(mapChannelRow);
  }

  public async findByTenantAndProvider(
    tenantId: string,
    provider: TenantWhatsAppChannelProvider,
  ): Promise<TenantWhatsAppChannelRecord | null> {
    const [row] = await db
      .select()
      .from(TenantWhatsAppChannelsTable)
      .where(
        and(
          eq(TenantWhatsAppChannelsTable.tenantId, tenantId),
          eq(TenantWhatsAppChannelsTable.provider, provider),
        ),
      )
      .orderBy(asc(TenantWhatsAppChannelsTable.createdAt))
      .limit(1);

    return row ? mapChannelRow(row) : null;
  }

  public async findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<TenantWhatsAppChannelRecord | null> {
    const [row] = await db
      .select()
      .from(TenantWhatsAppChannelsTable)
      .where(
        and(
          eq(TenantWhatsAppChannelsTable.provider, "EVOLUTION"),
          sql`${TenantWhatsAppChannelsTable.credentials}->>'instanceName' = ${instanceName}`,
        ),
      )
      .limit(1);

    return row ? mapChannelRow(row) : null;
  }

  public async upsertChannel(
    input: UpsertTenantWhatsAppChannelInput,
  ): Promise<TenantWhatsAppChannelRecord> {
    const existing = await this.findByTenantAndProvider(
      input.tenantId,
      input.provider,
    );
    const now = new Date();

    if (existing) {
      const nextCredentials = input.credentials
        ? { ...existing.credentials, ...input.credentials }
        : existing.credentials;

      const [updated] = await db
        .update(TenantWhatsAppChannelsTable)
        .set({
          purpose: input.purpose ?? existing.purpose,
          phoneNumber:
            input.phoneNumber !== undefined
              ? input.phoneNumber
              : existing.phoneNumber,
          status: input.status,
          credentials: nextCredentials,
          updatedAt: now,
        })
        .where(
          and(
            eq(TenantWhatsAppChannelsTable.id, existing.id),
            eq(TenantWhatsAppChannelsTable.tenantId, input.tenantId),
          ),
        )
        .returning();

      return mapChannelRow(updated!);
    }

    const [created] = await db
      .insert(TenantWhatsAppChannelsTable)
      .values({
        tenantId: input.tenantId,
        provider: input.provider,
        purpose: input.purpose ?? "ALL",
        phoneNumber: input.phoneNumber ?? null,
        status: input.status,
        credentials: input.credentials ?? {},
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return mapChannelRow(created!);
  }
}
