import type { AiConversationInsight } from "../entities/ai-conversation-insight.entity.js";

export interface AiConversationInsightsRepository {
  findByConversationId(
    companyId: string,
    conversationId: string,
  ): Promise<AiConversationInsight | null>;

  listByCompany(companyId: string): Promise<AiConversationInsight[]>;

  upsert(insight: AiConversationInsight): Promise<AiConversationInsight>;
}
