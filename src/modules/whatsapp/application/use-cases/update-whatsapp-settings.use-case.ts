import { CompanyWhatsAppConnection } from "../../domain/entities/company-whatsapp-connection.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../../domain/repositories/company-whatsapp-connection.repository.js";
import {
  mapConnectionToDTO,
  type WhatsAppConnectionDTO,
} from "./get-whatsapp-connection.use-case.js";

export interface UpdateWhatsAppSettingsInput {
  companyId: string;
  aiAutopilotEnabled?: boolean | undefined;
  aiSystemPrompt?: string | null | undefined;
}

export class UpdateWhatsAppSettingsUseCase {
  constructor(
    private readonly repository: CompanyWhatsAppConnectionRepository,
    private readonly conversationalMode: () => "LIVE" | "MOCK_READY",
  ) {}

  async execute(input: UpdateWhatsAppSettingsInput): Promise<WhatsAppConnectionDTO> {
    const existing =
      (await this.repository.findByCompanyId(input.companyId)) ??
      CompanyWhatsAppConnection.createDefault(input.companyId);

    const normalizedPrompt =
      input.aiSystemPrompt === undefined
        ? undefined
        : input.aiSystemPrompt === null
          ? null
          : input.aiSystemPrompt.trim() || null;

    const updated = await this.repository.upsert(
      existing.withSettings({
        aiAutopilotEnabled: input.aiAutopilotEnabled,
        aiSystemPrompt: normalizedPrompt,
      }),
    );

    return mapConnectionToDTO(updated, this.conversationalMode());
  }
}
