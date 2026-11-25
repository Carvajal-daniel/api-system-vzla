import {
  CompanyWhatsAppConnection,
  type EvolutionConnectionStatus,
} from "../../domain/entities/company-whatsapp-connection.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import type { WhatsAppConversationalPort } from "../ports/whatsapp-conversational.port.js";

export interface ConnectEvolutionWhatsAppOutput {
  instanceName: string;
  status: EvolutionConnectionStatus;
  qrCodeBase64: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
  mode: "LIVE" | "MOCK_READY";
}

export class ConnectEvolutionWhatsAppUseCase {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly conversationalPort: WhatsAppConversationalPort,
  ) {}

  async execute(companyId: string): Promise<ConnectEvolutionWhatsAppOutput> {
    const existing =
      (await this.repository.findByCompanyId(companyId)) ??
      CompanyWhatsAppConnection.createDefault(companyId);

    const result = await this.conversationalPort.connectAndGetQrCode(
      companyId,
      existing.evolutionInstanceName,
    );

    await this.repository.upsert(
      existing.withEvolutionState({
        instanceName: result.instanceName,
        status: result.status,
        phoneNumber: result.phoneNumber,
      }),
    );

    return {
      instanceName: result.instanceName,
      status: result.status,
      qrCodeBase64: result.qrCodeBase64,
      pairingCode: result.pairingCode ?? null,
      phoneNumber: result.phoneNumber,
      mode: result.mode,
    };
  }
}
