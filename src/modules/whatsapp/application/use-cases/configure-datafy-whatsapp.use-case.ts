import { CompanyWhatsAppConnection } from "../../domain/entities/company-whatsapp-connection.entity.js";
import { InvalidDatafyCredentialsError } from "../../domain/errors/whatsapp-errors.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import type { SecretCipherPort } from "../ports/secret-cipher.port.js";
import type { WhatsAppCampaignPort } from "../ports/whatsapp-campaign.port.js";
import {
  mapConnectionToDTO,
  type WhatsAppConnectionDTO,
} from "./get-whatsapp-connection.use-case.js";

export interface ConfigureDatafyInput {
  companyId: string;
  enabled?: boolean | undefined;
  datafyInstanceId?: string | null | undefined;
  datafyApiToken?: string | null | undefined;
}

export class ConfigureDatafyWhatsAppUseCase {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly campaignPort: WhatsAppCampaignPort,
    private readonly secretCipher: SecretCipherPort,
    private readonly conversationalMode: () => "LIVE" | "MOCK_READY",
  ) {}

  async execute(input: ConfigureDatafyInput): Promise<WhatsAppConnectionDTO> {
    const existing =
      (await this.repository.findByCompanyId(input.companyId)) ??
      CompanyWhatsAppConnection.createDefault(input.companyId);

    const nextEnabled = input.enabled ?? true;
    const trimmedInstanceId =
      input.datafyInstanceId !== undefined
        ? input.datafyInstanceId?.trim() || null
        : existing.datafyInstanceId;
    const trimmedApiToken =
      input.datafyApiToken !== undefined
        ? input.datafyApiToken?.trim() || null
        : null;

    if (!nextEnabled) {
      const updated = await this.repository.upsert(
        existing.withDatafyConfig({
          enabled: false,
          instanceId: trimmedInstanceId,
          apiTokenEncrypted:
            input.datafyApiToken === null
              ? null
              : trimmedApiToken
                ? this.secretCipher.encrypt(trimmedApiToken)
                : existing.datafyApiTokenEncrypted,
          status: "DISCONNECTED",
        }),
      );
      return mapConnectionToDTO(updated, this.conversationalMode());
    }

    const plainToken =
      trimmedApiToken ??
      (existing.datafyApiTokenEncrypted
        ? this.secretCipher.decrypt(existing.datafyApiTokenEncrypted)
        : null);

    if (!trimmedInstanceId || !plainToken) {
      throw new InvalidDatafyCredentialsError(
        "Informe o Instance ID e o API Token da Datafy para ativar o canal de campanhas.",
      );
    }

    const validation = await this.campaignPort.validateCredentials({
      companyId: input.companyId,
      instanceId: trimmedInstanceId,
      apiToken: plainToken,
    });

    if (!validation.valid) {
      throw new InvalidDatafyCredentialsError(
        validation.reason ?? "Não foi possível validar as credenciais da Datafy.",
      );
    }

    const encryptedToken = trimmedApiToken
      ? this.secretCipher.encrypt(trimmedApiToken)
      : existing.datafyApiTokenEncrypted;

    const updated = await this.repository.upsert(
      existing.withDatafyConfig({
        enabled: true,
        instanceId: trimmedInstanceId,
        apiTokenEncrypted: encryptedToken,
        status: "CONNECTED",
      }),
    );

    return mapConnectionToDTO(updated, this.conversationalMode());
  }
}
