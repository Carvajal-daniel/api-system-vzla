import { CompanyWhatsAppConnection } from "../../domain/entities/company-whatsapp-connection.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import type { WhatsAppConversationalPort } from "../ports/whatsapp-conversational.port.js";

export class DisconnectEvolutionWhatsAppUseCase {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly conversationalPort: WhatsAppConversationalPort,
  ) {}

  async execute(companyId: string): Promise<{ status: "DISCONNECTED" }> {
    const existing =
      (await this.repository.findByCompanyId(companyId)) ??
      CompanyWhatsAppConnection.createDefault(companyId);

    const instanceName =
      existing.evolutionInstanceName ??
      CompanyWhatsAppConnection.buildInstanceName(companyId);

    await this.conversationalPort.disconnect(companyId, instanceName);

    await this.repository.upsert(
      existing.withEvolutionState({
        instanceName,
        status: "DISCONNECTED",
        phoneNumber: null,
      }),
    );

    return { status: "DISCONNECTED" };
  }
}
