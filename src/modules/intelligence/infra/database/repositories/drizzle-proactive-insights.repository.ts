import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import {
  AiProactiveInsightsTable,
  type AiProactiveInsightStatus,
} from "../../../../billing/infra/database/schema/ai-proactive-insights-schema.js";
import type {
  CreateProactiveInsightRecordInput,
  ProactiveInsightRecord,
} from "../../../domain/entities/proactive-insight.types.js";
import type {
  ListProactiveInsightsParams,
  ListProactiveInsightsResult,
  ProactiveInsightsRepository,
} from "../../../domain/repositories/proactive-insights.repository.js";

function mapRow(
  row: typeof AiProactiveInsightsTable.$inferSelect,
): ProactiveInsightRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    module: row.module,
    type: row.type,
    title: row.title,
    description: row.description,
    impactLabel: row.impactLabel ?? null,
    actionPayload: row.actionPayload ?? null,
    status: row.status,
    expiresAt: row.expiresAt ?? null,
    createdAt: row.createdAt,
  };
}

// Repositório Drizzle para ai_proactive_insights com filtro obrigatório por tenantId em todas as operações.
export class DrizzleProactiveInsightsRepository
  implements ProactiveInsightsRepository
{
  public async listByTenant(
    params: ListProactiveInsightsParams,
  ): Promise<ListProactiveInsightsResult> {
    const conditions = [eq(AiProactiveInsightsTable.tenantId, params.tenantId)];
    if (params.module) {
      conditions.push(eq(AiProactiveInsightsTable.module, params.module));
    }
    if (params.status) {
      conditions.push(eq(AiProactiveInsightsTable.status, params.status));
    }

    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

    const [rows, pendingRows] = await Promise.all([
      db
        .select()
        .from(AiProactiveInsightsTable)
        .where(and(...conditions))
        .orderBy(desc(AiProactiveInsightsTable.createdAt))
        .limit(limit),
      db
        .select({
          count: sql<number>`COUNT(*)::int`,
        })
        .from(AiProactiveInsightsTable)
        .where(
          and(
            eq(AiProactiveInsightsTable.tenantId, params.tenantId),
            eq(AiProactiveInsightsTable.status, "PENDING"),
          ),
        ),
    ]);

    return {
      insights: rows.map(mapRow),
      pendingCount: pendingRows[0]?.count ?? 0,
    };
  }

  public async findByIdForTenant(
    tenantId: string,
    insightId: string,
  ): Promise<ProactiveInsightRecord | null> {
    const [row] = await db
      .select()
      .from(AiProactiveInsightsTable)
      .where(
        and(
          eq(AiProactiveInsightsTable.tenantId, tenantId),
          eq(AiProactiveInsightsTable.id, insightId),
        ),
      )
      .limit(1);

    return row ? mapRow(row) : null;
  }

  public async existsPendingTodayByType(
    tenantId: string,
    type: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const startOfUtcDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
    );

    const [row] = await db
      .select({ id: AiProactiveInsightsTable.id })
      .from(AiProactiveInsightsTable)
      .where(
        and(
          eq(AiProactiveInsightsTable.tenantId, tenantId),
          eq(AiProactiveInsightsTable.type, type),
          eq(AiProactiveInsightsTable.status, "PENDING"),
          gte(AiProactiveInsightsTable.createdAt, startOfUtcDay),
        ),
      )
      .limit(1);

    return Boolean(row);
  }

  public async create(
    input: CreateProactiveInsightRecordInput,
  ): Promise<ProactiveInsightRecord> {
    const [row] = await db
      .insert(AiProactiveInsightsTable)
      .values({
        tenantId: input.tenantId,
        module: input.module,
        type: input.type,
        title: input.title.slice(0, 160),
        description: input.description,
        impactLabel: input.impactLabel ? input.impactLabel.slice(0, 80) : null,
        actionPayload: input.actionPayload ?? null,
        status: "PENDING",
        expiresAt: input.expiresAt ?? null,
      })
      .returning();

    return mapRow(row!);
  }

  public async updateStatusForTenant(
    tenantId: string,
    insightId: string,
    status: AiProactiveInsightStatus,
  ): Promise<ProactiveInsightRecord | null> {
    const [row] = await db
      .update(AiProactiveInsightsTable)
      .set({ status })
      .where(
        and(
          eq(AiProactiveInsightsTable.tenantId, tenantId),
          eq(AiProactiveInsightsTable.id, insightId),
        ),
      )
      .returning();

    return row ? mapRow(row) : null;
  }
}
