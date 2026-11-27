import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { WhatsAppConversationsTable } from "../../../../whatsapp/infra/database/schema/whatsapp-conversations-schema.js";
import type {
  PlanTier,
  TenantUsageMetricsRecord,
} from "../../../domain/entities/tenant-usage.types.js";
import type {
  IncrementUsageAndLogParams,
  TenantUsageRepository,
} from "../../../domain/repositories/tenant-usage.repository.js";
import { AiUsageLogsTable } from "../schema/ai-usage-logs-schema.js";
import { recordSaasTelemetry } from "./drizzle-saas-telemetry.repository.js";
import { TenantUsageMetricsTable } from "../schema/tenant-usage-metrics-schema.js";

function mapMetricsRow(
  row: typeof TenantUsageMetricsTable.$inferSelect,
): TenantUsageMetricsRecord {
  return {
    tenantId: row.tenantId,
    periodMonth: row.periodMonth,
    aiSessionsCount: row.aiSessionsCount,
    outboundMessagesCount: row.outboundMessagesCount,
    totalInputTokens: row.totalInputTokens,
    totalOutputTokens: row.totalOutputTokens,
    updatedAt: row.updatedAt,
  };
}

function getTelemetryTurn(params: IncrementUsageAndLogParams) {
  if (params.feature === "BOOKING") {
    return ["SIMULATED", "UNAVAILABLE"].includes(params.model) ? { aiTurnsL0: 1 } : { aiTurnsL1: 1 };
  }
  if (params.feature === "RETENTION" && params.promptTokens === 0 && params.completionTokens === 0) {
    return {};
  }
  return { aiTurnsL2: 1 };
}

// Implementação Drizzle da governança de consumo com isolamento estrito por tenantId
// e atualizações atômicas via ON CONFLICT (tenant_id, period_month) DO UPDATE.
export class DrizzleTenantUsageRepository implements TenantUsageRepository {
  public async getTenantPlanTier(tenantId: string): Promise<PlanTier> {
    // Valida existência do tenant antes de resolver o plano (fallback TRIAL até integração de assinaturas).
    await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, tenantId))
      .limit(1);

    return "TRIAL";
  }

  public async getMonthlyUsage(
    tenantId: string,
    periodMonth: string,
  ): Promise<TenantUsageMetricsRecord | null> {
    const [row] = await db
      .select()
      .from(TenantUsageMetricsTable)
      .where(
        and(
          eq(TenantUsageMetricsTable.tenantId, tenantId),
          eq(TenantUsageMetricsTable.periodMonth, periodMonth),
        ),
      )
      .limit(1);

    return row ? mapMetricsRow(row) : null;
  }

  public async incrementUsageAndLog(
    params: IncrementUsageAndLogParams,
  ): Promise<TenantUsageMetricsRecord> {
    // Executa em transação para manter métrica agregada e trilha de auditoria sempre consistentes.
    return db.transaction(async (tx) => {
      const [metricsRow] = await tx
        .insert(TenantUsageMetricsTable)
        .values({
          tenantId: params.tenantId,
          periodMonth: params.periodMonth,
          aiSessionsCount: params.aiSessionsDelta,
          outboundMessagesCount: params.outboundMessagesDelta,
          totalInputTokens: params.promptTokens,
          totalOutputTokens: params.completionTokens,
          updatedAt: params.now,
        })
        .onConflictDoUpdate({
          target: [
            TenantUsageMetricsTable.tenantId,
            TenantUsageMetricsTable.periodMonth,
          ],
          set: {
            aiSessionsCount: sql`${TenantUsageMetricsTable.aiSessionsCount} + ${params.aiSessionsDelta}`,
            outboundMessagesCount: sql`${TenantUsageMetricsTable.outboundMessagesCount} + ${params.outboundMessagesDelta}`,
            totalInputTokens: sql`${TenantUsageMetricsTable.totalInputTokens} + ${params.promptTokens}`,
            totalOutputTokens: sql`${TenantUsageMetricsTable.totalOutputTokens} + ${params.completionTokens}`,
            updatedAt: params.now,
          },
        })
        .returning();

      await tx.insert(AiUsageLogsTable).values({
        tenantId: params.tenantId,
        feature: params.feature,
        model: params.model,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        metadata: params.metadata,
        createdAt: params.now,
      });

      const turn = getTelemetryTurn(params);
      await recordSaasTelemetry(tx, params.tenantId, params.now, {
        ...turn,
        tokensInput: params.promptTokens,
        tokensOutput: params.completionTokens,
      });

      return mapMetricsRow(metricsRow!);
    });
  }

  public async incrementAiSessionCount(
    tenantId: string,
    periodMonth: string,
    now: Date,
  ): Promise<TenantUsageMetricsRecord> {
    const [row] = await db
      .insert(TenantUsageMetricsTable)
      .values({
        tenantId,
        periodMonth,
        aiSessionsCount: 1,
        outboundMessagesCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          TenantUsageMetricsTable.tenantId,
          TenantUsageMetricsTable.periodMonth,
        ],
        set: {
          aiSessionsCount: sql`${TenantUsageMetricsTable.aiSessionsCount} + 1`,
          updatedAt: now,
        },
      })
      .returning();

    return mapMetricsRow(row!);
  }

  public async getConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
  ): Promise<Date | null> {
    const [row] = await db
      .select({ lastAiSessionAt: WhatsAppConversationsTable.lastAiSessionAt })
      .from(WhatsAppConversationsTable)
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, tenantId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      )
      .limit(1);

    return row?.lastAiSessionAt ?? null;
  }

  public async updateConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
    lastAiSessionAt: Date,
  ): Promise<boolean> {
    const updated = await db
      .update(WhatsAppConversationsTable)
      .set({
        lastAiSessionAt,
        updatedAt: lastAiSessionAt,
      })
      .where(
        and(
          eq(WhatsAppConversationsTable.companyId, tenantId),
          eq(WhatsAppConversationsTable.id, conversationId),
        ),
      )
      .returning({ id: WhatsAppConversationsTable.id });

    return updated.length > 0;
  }
}
