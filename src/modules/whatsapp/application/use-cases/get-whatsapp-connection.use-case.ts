import {
  CompanyWhatsAppConnection,
  type DatafyConnectionStatus,
  type EvolutionConnectionStatus,
} from "../../domain/entities/company-whatsapp-connection.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import type { WhatsAppConversationalPort } from "../ports/whatsapp-conversational.port.js";

export interface WhatsAppConnectionDTO {
  companyId: string;
  evolution: {
    instanceName: string;
    status: EvolutionConnectionStatus;
    phoneNumber: string | null;
    mode: "LIVE" | "MOCK_READY";
  };
  datafy: {
    enabled: boolean;
    instanceId: string | null;
    hasApiToken: boolean;
    status: DatafyConnectionStatus;
  };
  settings: {
    aiAutopilotEnabled: boolean;
    aiSystemPrompt: string | null;
  };
  updatedAt: string;
}

export function mapConnectionToDTO(
  connection: CompanyWhatsAppConnection,
  mode: "LIVE" | "MOCK_READY",
): WhatsAppConnectionDTO {
  return {
    companyId: connection.companyId,
    evolution: {
      instanceName:
        connection.evolutionInstanceName ??
        CompanyWhatsAppConnection.buildInstanceName(connection.companyId),
      status: connection.evolutionStatus,
      phoneNumber: connection.evolutionPhoneNumber,
      mode,
    },
    datafy: {
      enabled: connection.datafyEnabled,
      instanceId: connection.datafyInstanceId,
      hasApiToken: Boolean(connection.datafyApiTokenEncrypted),
      status: connection.datafyStatus,
    },
    settings: {
      aiAutopilotEnabled: connection.aiAutopilotEnabled,
      aiSystemPrompt: connection.aiSystemPrompt,
    },
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export class GetWhatsAppConnectionUseCase {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly conversationalPort: WhatsAppConversationalPort,
  ) {}

  async execute(companyId: string): Promise<WhatsAppConnectionDTO> {
    const existing =
      (await this.repository.findByCompanyId(companyId)) ??
      CompanyWhatsAppConnection.createDefault(companyId);

    const liveStatus = await this.conversationalPort.getStatus(
      companyId,
      existing.evolutionInstanceName,
    );

    const shouldSyncStatus =
      liveStatus.mode === "LIVE" &&
      (liveStatus.status !== existing.evolutionStatus ||
        liveStatus.instanceName !== existing.evolutionInstanceName ||
        (liveStatus.phoneNumber !== null &&
          liveStatus.phoneNumber !== existing.evolutionPhoneNumber));

    if (shouldSyncStatus) {
      const updated = await this.repository.upsert(
        existing.withEvolutionState({
          instanceName: liveStatus.instanceName,
          status: liveStatus.status,
          phoneNumber: liveStatus.phoneNumber ?? existing.evolutionPhoneNumber,
        }),
      );
      return mapConnectionToDTO(updated, liveStatus.mode);
    }

    return mapConnectionToDTO(existing, liveStatus.mode);
  }
}
