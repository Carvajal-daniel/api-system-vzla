import type { CompanyWhatsAppConnection } from "../entities/company-whatsapp-connection.entity.js";

export interface CompanyWhatsAppConnectionRepository {
  findByCompanyId(companyId: string): Promise<CompanyWhatsAppConnection | null>;
  findByEvolutionInstanceName(
    instanceName: string,
  ): Promise<CompanyWhatsAppConnection | null>;
  upsert(connection: CompanyWhatsAppConnection): Promise<CompanyWhatsAppConnection>;
}
