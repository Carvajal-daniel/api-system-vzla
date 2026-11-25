import { randomUUID } from "node:crypto";
import type {
  DatafyCredentialsInput,
  DatafyValidationResult,
  SendCampaignMessageInput,
  SendCampaignMessageResult,
  WhatsAppCampaignPort,
} from "../../application/ports/whatsapp-campaign.port.js";

// Adaptador da API Oficial Datafy para campanhas e disparos em massa.
// Mantém a estrutura tipada pronta aguardando os endpoints oficiais de produção da Datafy.
export class DatafyWhatsAppAdapter implements WhatsAppCampaignPort {
  async validateCredentials(
    input: DatafyCredentialsInput,
  ): Promise<DatafyValidationResult> {
    const instanceId = input.instanceId.trim();
    const apiToken = input.apiToken.trim();

    if (instanceId.length < 3) {
      return {
        valid: false,
        reason: "O Datafy Instance ID deve ter pelo menos 3 caracteres.",
      };
    }

    if (apiToken.length < 8) {
      return {
        valid: false,
        reason: "O Datafy API Token deve ter pelo menos 8 caracteres.",
      };
    }

    // Quando WHATSAPP_DATAFY_API_URL for configurado futuramente, validará contra o endpoint oficial.
    return { valid: true };
  }

  async sendTemplateOrBulkMessage(
    input: SendCampaignMessageInput,
  ): Promise<SendCampaignMessageResult> {
    const validation = await this.validateCredentials({
      companyId: input.companyId,
      instanceId: input.instanceId,
      apiToken: input.apiToken,
    });

    if (!validation.valid) {
      throw new Error(validation.reason ?? "Invalid Datafy credentials.");
    }

    // Stub tipado pronto para integração com o endpoint oficial de disparos em massa da Datafy.
    return {
      batchId: `datafy_stub_${randomUUID()}`,
      acceptedCount: input.recipients.length,
      provider: "DATAFY",
    };
  }
}
