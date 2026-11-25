import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyWhatsAppConnection } from "../../../domain/entities/company-whatsapp-connection.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../../domain/repositories/company-whatsapp-connection.repository.js";
import { CompanyWhatsAppConnectionTable } from "../schema/company-whatsapp-connections-schema.js";

export class DrizzleCompanyWhatsAppConnectionRepository
  implements CompanyWhatsAppConnectionRepository
{
  async findByCompanyId(
    companyId: string,
  ): Promise<CompanyWhatsAppConnection | null> {
    const [row] = await db
      .select()
      .from(CompanyWhatsAppConnectionTable)
      .where(eq(CompanyWhatsAppConnectionTable.companyId, companyId))
      .limit(1);

    if (!row) return null;

    return CompanyWhatsAppConnection.restore({
      companyId: row.companyId,
      evolutionInstanceName: row.evolutionInstanceName,
      evolutionStatus: row.evolutionStatus,
      evolutionPhoneNumber: row.evolutionPhoneNumber,
      datafyEnabled: row.datafyEnabled,
      datafyInstanceId: row.datafyInstanceId,
      datafyApiTokenEncrypted: row.datafyApiTokenEncrypted,
      datafyStatus: row.datafyStatus,
      aiAutopilotEnabled: row.aiAutopilotEnabled,
      aiSystemPrompt: row.aiSystemPrompt,
      updatedAt: row.updatedAt,
    });
  }

  async findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<CompanyWhatsAppConnection | null> {
    const [row] = await db
      .select()
      .from(CompanyWhatsAppConnectionTable)
      .where(eq(CompanyWhatsAppConnectionTable.evolutionInstanceName, instanceName))
      .limit(1);

    if (!row) return null;

    return CompanyWhatsAppConnection.restore({
      companyId: row.companyId,
      evolutionInstanceName: row.evolutionInstanceName,
      evolutionStatus: row.evolutionStatus,
      evolutionPhoneNumber: row.evolutionPhoneNumber,
      datafyEnabled: row.datafyEnabled,
      datafyInstanceId: row.datafyInstanceId,
      datafyApiTokenEncrypted: row.datafyApiTokenEncrypted,
      datafyStatus: row.datafyStatus,
      aiAutopilotEnabled: row.aiAutopilotEnabled,
      aiSystemPrompt: row.aiSystemPrompt,
      updatedAt: row.updatedAt,
    });
  }

  async upsert(
    connection: CompanyWhatsAppConnection,
  ): Promise<CompanyWhatsAppConnection> {
    const data = connection.toPersistence();
    const [row] = await db
      .insert(CompanyWhatsAppConnectionTable)
      .values(data)
      .onConflictDoUpdate({
        target: CompanyWhatsAppConnectionTable.companyId,
        set: {
          evolutionInstanceName: data.evolutionInstanceName,
          evolutionStatus: data.evolutionStatus,
          evolutionPhoneNumber: data.evolutionPhoneNumber,
          datafyEnabled: data.datafyEnabled,
          datafyInstanceId: data.datafyInstanceId,
          datafyApiTokenEncrypted: data.datafyApiTokenEncrypted,
          datafyStatus: data.datafyStatus,
          aiAutopilotEnabled: data.aiAutopilotEnabled,
          aiSystemPrompt: data.aiSystemPrompt,
          updatedAt: data.updatedAt,
        },
      })
      .returning();

    const saved = row!;
    return CompanyWhatsAppConnection.restore({
      companyId: saved.companyId,
      evolutionInstanceName: saved.evolutionInstanceName,
      evolutionStatus: saved.evolutionStatus,
      evolutionPhoneNumber: saved.evolutionPhoneNumber,
      datafyEnabled: saved.datafyEnabled,
      datafyInstanceId: saved.datafyInstanceId,
      datafyApiTokenEncrypted: saved.datafyApiTokenEncrypted,
      datafyStatus: saved.datafyStatus,
      aiAutopilotEnabled: saved.aiAutopilotEnabled,
      aiSystemPrompt: saved.aiSystemPrompt,
      updatedAt: saved.updatedAt,
    });
  }
}
