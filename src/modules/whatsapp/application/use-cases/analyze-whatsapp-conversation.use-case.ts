import {
  AiConversationInsight,
  type AiConversationInsightDTO,
} from "../../domain/entities/ai-conversation-insight.entity.js";
import type { AiConversationInsightsRepository } from "../../domain/repositories/ai-conversation-insights.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { ConversationAnalyzerPort } from "../ports/conversation-analyzer.port.js";

export interface AnalyzeWhatsAppConversationInput {
  companyId: string;
  conversationId: string;
  forceConverted?: boolean | undefined;
}

// Caso de uso que analisa o histórico recente da conversa via IA/heurística,
// persiste o insight comercial e marca a conversa como CONVERTED quando houver confirmação de agendamento.
export class AnalyzeWhatsAppConversationUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly insightsRepository: AiConversationInsightsRepository,
    private readonly analyzer: ConversationAnalyzerPort,
  ) {}

  async execute(
    input: AnalyzeWhatsAppConversationInput,
  ): Promise<AiConversationInsightDTO | null> {
    const conversation = await this.conversationsRepository.findById(
      input.companyId,
      input.conversationId,
    );
    if (!conversation) {
      return null;
    }

    const recentMessages =
      await this.messagesRepository.listRecentByConversation(
        input.companyId,
        conversation.id,
        20,
      );

    const analysis = await this.analyzer.analyze({
      companyId: input.companyId,
      conversationId: conversation.id,
      contactName: conversation.contactName,
      phone: conversation.phone,
      currentStatus: conversation.status,
      messages: recentMessages.map((msg) => ({
        direction: msg.direction,
        senderType: msg.senderType,
        content: msg.content,
        sentAt: msg.sentAt.toISOString(),
      })),
    });

    const isConverted =
      Boolean(input.forceConverted) ||
      analysis.appointmentConfirmed ||
      conversation.status === "CONVERTED";

    if (isConverted && conversation.status !== "CONVERTED") {
      await this.conversationsRepository.updateStatus(
        input.companyId,
        conversation.id,
        "CONVERTED",
      );
    }

    const now = new Date();
    const insight = AiConversationInsight.create({
      companyId: input.companyId,
      conversationId: conversation.id,
      leadTemperature: isConverted ? "HOT" : analysis.leadTemperature,
      leadScore: isConverted
        ? Math.max(90, analysis.leadScore)
        : analysis.leadScore,
      summary: analysis.summary,
      detectedObjection: isConverted ? "NONE" : analysis.detectedObjection,
      recommendedNextAction: analysis.recommendedNextAction,
      suggestedFollowupReply: analysis.suggestedFollowupReply,
      analyzedAt: now,
      updatedAt: now,
    });

    const saved = await this.insightsRepository.upsert(insight);
    return saved.toDTO();
  }

  // Dispara a análise em segundo plano sem bloquear o webhook ou o envio manual de mensagens.
  triggerAsync(input: AnalyzeWhatsAppConversationInput): void {
    void this.execute(input).catch(() => undefined);
  }
}
