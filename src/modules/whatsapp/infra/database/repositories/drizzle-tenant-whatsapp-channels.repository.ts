import { and, asc, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import type {
  TenantWhatsAppChannelRecord,
  TenantWhatsAppChannelsRepository,
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
}
