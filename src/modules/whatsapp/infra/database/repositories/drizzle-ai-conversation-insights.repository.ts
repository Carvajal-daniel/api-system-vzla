import { and, desc, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AiConversationInsight } from "../../../domain/entities/ai-conversation-insight.entity.js";
import type { AiConversationInsightsRepository } from "../../../domain/repositories/ai-conversation-insights.repository.js";
import { AiConversationInsightsTable } from "../schema/ai-conversation-insights-schema.js";

function mapRow(
  row: typeof AiConversationInsightsTable.$inferSelect,
): AiConversationInsight {
  return AiConversationInsight.restore({
    id: row.id,
    companyId: row.companyId,
    conversationId: row.conversationId,
    leadTemperature: row.leadTemperature,
    leadScore: row.leadScore,
    summary: row.summary,
    detectedObjection: row.detectedObjection,
    recommendedNextAction: row.recommendedNextAction,
    suggestedFollowupReply: row.suggestedFollowupReply,
    analyzedAt: row.analyzedAt,
    updatedAt: row.updatedAt,
  });
}

// Repositório Drizzle isolado por companyId para persistência dos insights comerciais das conversas.
export class DrizzleAiConversationInsightsRepository
  implements AiConversationInsightsRepository
{
  async findByConversationId(
    companyId: string,
    conversationId: string,
  ): Promise<AiConversationInsight | null> {
    const [row] = await db
      .select()
      .from(AiConversationInsightsTable)
      .where(
        and(
          eq(AiConversationInsightsTable.companyId, companyId),
          eq(AiConversationInsightsTable.conversationId, conversationId),
        ),
      )
      .limit(1);

    return row ? mapRow(row) : null;
  }

  async listByCompany(companyId: string): Promise<AiConversationInsight[]> {
    const rows = await db
      .select()
      .from(AiConversationInsightsTable)
      .where(eq(AiConversationInsightsTable.companyId, companyId))
      .orderBy(desc(AiConversationInsightsTable.updatedAt));

    return rows.map(mapRow);
  }

  async upsert(insight: AiConversationInsight): Promise<AiConversationInsight> {
    const data = insight.toPersistence();
    const now = new Date();

    const [row] = await db
      .insert(AiConversationInsightsTable)
      .values({
        id: data.id,
        companyId: data.companyId,
        conversationId: data.conversationId,
        leadTemperature: data.leadTemperature,
        leadScore: data.leadScore,
        summary: data.summary,
        detectedObjection: data.detectedObjection,
        recommendedNextAction: data.recommendedNextAction,
        suggestedFollowupReply: data.suggestedFollowupReply,
        analyzedAt: data.analyzedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          AiConversationInsightsTable.companyId,
          AiConversationInsightsTable.conversationId,
        ],
        set: {
          leadTemperature: data.leadTemperature,
          leadScore: data.leadScore,
          summary: data.summary,
          detectedObjection: data.detectedObjection,
          recommendedNextAction: data.recommendedNextAction,
          suggestedFollowupReply: data.suggestedFollowupReply,
          analyzedAt: data.analyzedAt,
          updatedAt: now,
        },
      })
      .returning();

    return mapRow(row!);
  }
}
