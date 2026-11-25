export type EvolutionConnectionStatus =
  | "DISCONNECTED"
  | "QRCODE_PENDING"
  | "CONNECTED";

export type DatafyConnectionStatus = "DISCONNECTED" | "CONNECTED";

export type WhatsAppMessagePurpose = "CONVERSATIONAL_REPLY" | "CAMPAIGN_BLAST";

export interface CompanyWhatsAppConnectionProps {
  companyId: string;
  evolutionInstanceName: string | null;
  evolutionStatus: EvolutionConnectionStatus;
  evolutionPhoneNumber: string | null;
  datafyEnabled: boolean;
  datafyInstanceId: string | null;
  datafyApiTokenEncrypted: string | null;
  datafyStatus: DatafyConnectionStatus;
  aiAutopilotEnabled: boolean;
  aiSystemPrompt: string | null;
  updatedAt: Date;
}

// Entidade de domínio que representa o estado e a configuração dos canais de WhatsApp de uma empresa.
export class CompanyWhatsAppConnection {
  private readonly props: CompanyWhatsAppConnectionProps;

  private constructor(props: CompanyWhatsAppConnectionProps) {
    this.props = props;
  }

  public static createDefault(companyId: string): CompanyWhatsAppConnection {
    return new CompanyWhatsAppConnection({
      companyId,
      evolutionInstanceName: CompanyWhatsAppConnection.buildInstanceName(companyId),
      evolutionStatus: "DISCONNECTED",
      evolutionPhoneNumber: null,
      datafyEnabled: false,
      datafyInstanceId: null,
      datafyApiTokenEncrypted: null,
      datafyStatus: "DISCONNECTED",
      aiAutopilotEnabled: true,
      aiSystemPrompt: null,
      updatedAt: new Date(),
    });
  }

  public static restore(props: CompanyWhatsAppConnectionProps): CompanyWhatsAppConnection {
    return new CompanyWhatsAppConnection(props);
  }

  // Convenção determinística de instância na Evolution API por empresa (multi-tenant).
  public static buildInstanceName(companyId: string): string {
    return `cloudgo_${companyId}`;
  }

  public get companyId(): string {
    return this.props.companyId;
  }

  public get evolutionInstanceName(): string | null {
    return this.props.evolutionInstanceName;
  }

  public get evolutionStatus(): EvolutionConnectionStatus {
    return this.props.evolutionStatus;
  }

  public get evolutionPhoneNumber(): string | null {
    return this.props.evolutionPhoneNumber;
  }

  public get datafyEnabled(): boolean {
    return this.props.datafyEnabled;
  }

  public get datafyInstanceId(): string | null {
    return this.props.datafyInstanceId;
  }

  public get datafyApiTokenEncrypted(): string | null {
    return this.props.datafyApiTokenEncrypted;
  }

  public get datafyStatus(): DatafyConnectionStatus {
    return this.props.datafyStatus;
  }

  public get aiAutopilotEnabled(): boolean {
    return this.props.aiAutopilotEnabled;
  }

  public get aiSystemPrompt(): string | null {
    return this.props.aiSystemPrompt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public isCampaignChannelReady(): boolean {
    return (
      this.props.datafyEnabled &&
      this.props.datafyStatus === "CONNECTED" &&
      Boolean(this.props.datafyInstanceId) &&
      Boolean(this.props.datafyApiTokenEncrypted)
    );
  }

  public withEvolutionState(input: {
    instanceName: string;
    status: EvolutionConnectionStatus;
    phoneNumber?: string | null;
  }): CompanyWhatsAppConnection {
    return new CompanyWhatsAppConnection({
      ...this.props,
      evolutionInstanceName: input.instanceName,
      evolutionStatus: input.status,
      evolutionPhoneNumber:
        input.phoneNumber !== undefined
          ? input.phoneNumber
          : this.props.evolutionPhoneNumber,
      updatedAt: new Date(),
    });
  }

  public withDatafyConfig(input: {
    enabled: boolean;
    instanceId: string | null;
    apiTokenEncrypted: string | null;
    status: DatafyConnectionStatus;
  }): CompanyWhatsAppConnection {
    return new CompanyWhatsAppConnection({
      ...this.props,
      datafyEnabled: input.enabled,
      datafyInstanceId: input.instanceId,
      datafyApiTokenEncrypted: input.apiTokenEncrypted,
      datafyStatus: input.status,
      updatedAt: new Date(),
    });
  }

  public withSettings(input: {
    aiAutopilotEnabled?: boolean | undefined;
    aiSystemPrompt?: string | null | undefined;
  }): CompanyWhatsAppConnection {
    return new CompanyWhatsAppConnection({
      ...this.props,
      aiAutopilotEnabled:
        input.aiAutopilotEnabled !== undefined
          ? input.aiAutopilotEnabled
          : this.props.aiAutopilotEnabled,
      aiSystemPrompt:
        input.aiSystemPrompt !== undefined
          ? input.aiSystemPrompt
          : this.props.aiSystemPrompt,
      updatedAt: new Date(),
    });
  }

  public toPersistence(): CompanyWhatsAppConnectionProps {
    return { ...this.props };
  }
}
