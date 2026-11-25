import type { WhatsAppConversationDTO } from "../../domain/entities/whatsapp-conversation.entity.js";
import { WhatsAppConversationNotFoundError } from "../../domain/errors/whatsapp-errors.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppAiTurnOrchestrator } from "../services/whatsapp-ai-turn-orchestrator.js";

const DEFAULT_MANUAL_PAUSE_HOURS = 24;

// Controla o transbordo humano explícito ("Assumir conversa" / "Reativar IA") no painel /owner/whatsapp,
// garantindo validação estrita por companyId e limpeza de timers pendentes da IA.
export class ManageWhatsAppConversationAiPauseUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly turnOrchestrator?: WhatsAppAiTurnOrchestrator,
  ) {}

  public async pauseAi(input: {
    companyId: string;
    conversationId: string;
    durationMinutes?: number | undefined;
    now?: Date | undefined;
  }): Promise<WhatsAppConversationDTO> {
    const now = input.now ?? new Date();
    const durationMs =
      input.durationMinutes && input.durationMinutes > 0
        ? input.durationMinutes * 60 * 1000
        : DEFAULT_MANUAL_PAUSE_HOURS * 60 * 60 * 1000;
    const aiPausedUntil = new Date(now.getTime() + durationMs);

    this.turnOrchestrator?.cancelTurn(input.companyId, input.conversationId);

    const updated = this.conversationsRepository.updateAiPauseState
      ? await this.conversationsRepository.updateAiPauseState({
          companyId: input.companyId,
          conversationId: input.conversationId,
          aiPausedUntil,
          assignedMode: "HUMAN",
        })
      : await this.conversationsRepository.updateAssignedMode(
          input.companyId,
          input.conversationId,
          "HUMAN",
        );

    if (!updated) {
      throw new WhatsAppConversationNotFoundError();
    }

    return updated.toDTO();
  }

  public async resumeAi(input: {
    companyId: string;
    conversationId: string;
  }): Promise<WhatsAppConversationDTO> {
    const updated = this.conversationsRepository.updateAiPauseState
      ? await this.conversationsRepository.updateAiPauseState({
          companyId: input.companyId,
          conversationId: input.conversationId,
          aiPausedUntil: null,
          assignedMode: "AI_AUTOPILOT",
        })
      : await this.conversationsRepository.updateAssignedMode(
          input.companyId,
          input.conversationId,
          "AI_AUTOPILOT",
        );

    if (!updated) {
      throw new WhatsAppConversationNotFoundError();
    }

    return updated.toDTO();
  }
}
