import type { SecretCipherPort } from "../../application/ports/secret-cipher.port.js";
import type { WhatsAppCampaignPort } from "../../application/ports/whatsapp-campaign.port.js";
import type { WhatsAppConversationalPort } from "../../application/ports/whatsapp-conversational.port.js";
import type { WhatsAppMessagePurpose } from "../../domain/entities/company-whatsapp-connection.entity.js";
import {
  CampaignChannelNotConfiguredError,
  WhatsAppChannelUnavailableError,
} from "../../domain/errors/whatsapp-errors.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";

export interface RouteConversationalInput {
  purpose: "CONVERSATIONAL_REPLY";
  companyId: string;
  phone: string;
  text: string;
}

export interface RouteCampaignInput {
  purpose: "CAMPAIGN_BLAST";
  companyId: string;
  recipients: string[];
  templateName?: string;
  bodyText: string;
}

export type RouteWhatsAppMessageInput =
  | RouteConversationalInput
  | RouteCampaignInput;

export interface RouteWhatsAppMessageOutput {
  purpose: WhatsAppMessagePurpose;
  provider: "EVOLUTION" | "MOCK_READY" | "DATAFY";
  referenceId: string;
}

// Serviço de infraestrutura que roteia envios por finalidade:
// - CONVERSATIONAL_REPLY -> Evolution API (atendimento 1-a-1)
// - CAMPAIGN_BLAST -> Datafy API Oficial (disparos em massa, exigindo canal ativo)
export class WhatsAppGatewayRouter {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly conversationalPort: WhatsAppConversationalPort,
    private readonly campaignPort: WhatsAppCampaignPort,
    private readonly secretCipher: SecretCipherPort,
  ) {}

  async send(
    input: RouteWhatsAppMessageInput,
  ): Promise<RouteWhatsAppMessageOutput> {
    const connection = await this.repository.findByCompanyId(input.companyId);

    if (input.purpose === "CONVERSATIONAL_REPLY") {
      const liveStatus = await this.conversationalPort.getStatus(
        input.companyId,
        connection?.evolutionInstanceName,
      );

      if (
        liveStatus.mode === "LIVE" &&
        liveStatus.status !== "CONNECTED" &&
        connection?.evolutionStatus !== "CONNECTED"
      ) {
        throw new WhatsAppChannelUnavailableError();
      }

      const result = await this.conversationalPort.sendTextMessage({
        companyId: input.companyId,
        instanceName: connection?.evolutionInstanceName,
        phone: input.phone,
        text: input.text,
      });

      return {
        purpose: "CONVERSATIONAL_REPLY",
        provider: result.provider,
        referenceId: result.messageId,
      };
    }

    // CAMPAIGN_BLAST exige obrigatoriamente Datafy habilitado e configurado para a empresa.
    if (!connection || !connection.isCampaignChannelReady()) {
      throw new CampaignChannelNotConfiguredError();
    }

    const decryptedToken = this.secretCipher.decrypt(
      connection.datafyApiTokenEncrypted!,
    );

    const campaignResult = await this.campaignPort.sendTemplateOrBulkMessage({
      companyId: input.companyId,
      instanceId: connection.datafyInstanceId!,
      apiToken: decryptedToken,
      recipients: input.recipients,
      templateName: input.templateName,
      bodyText: input.bodyText,
    });

    return {
      purpose: "CAMPAIGN_BLAST",
      provider: campaignResult.provider,
      referenceId: campaignResult.batchId,
    };
  }
}
