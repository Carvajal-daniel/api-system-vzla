export interface DatafyCredentialsInput {
  companyId: string;
  instanceId: string;
  apiToken: string;
}

export interface DatafyValidationResult {
  valid: boolean;
  reason?: string;
}

export interface SendCampaignMessageInput {
  companyId: string;
  instanceId: string;
  apiToken: string;
  recipients: string[];
  templateName?: string | undefined;
  bodyText: string;
}

export interface SendCampaignMessageResult {
  batchId: string;
  acceptedCount: number;
  provider: "DATAFY";
}

// Porta de disparos em massa e campanhas (API Oficial Datafy).
export interface WhatsAppCampaignPort {
  validateCredentials(input: DatafyCredentialsInput): Promise<DatafyValidationResult>;
  sendTemplateOrBulkMessage(input: SendCampaignMessageInput): Promise<SendCampaignMessageResult>;
}
