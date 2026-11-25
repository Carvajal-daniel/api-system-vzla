import { describe, expect, it } from "vitest";
import type {
  PlanTier,
  TenantUsageMetricsRecord,
} from "../../domain/entities/tenant-usage.types.js";
import type {
  IncrementUsageAndLogParams,
  TenantUsageRepository,
} from "../../domain/repositories/tenant-usage.repository.js";
import { PlanQuotaGuardUseCase } from "../use-cases/plan-quota-guard.use-case.js";

class InMemoryTenantUsageRepository implements TenantUsageRepository {
  public readonly plans = new Map<string, PlanTier>();
  public readonly metrics = new Map<string, TenantUsageMetricsRecord>();
  public readonly logs: IncrementUsageAndLogParams[] = [];
  // Chave composta `${tenantId}:${conversationId}` para garantir isolamento estrito por tenant nos testes.
  public readonly conversations = new Map<string, Date | null>();

  private metricKey(tenantId: string, periodMonth: string): string {
    return `${tenantId}:${periodMonth}`;
  }

  private convKey(tenantId: string, conversationId: string): string {
    return `${tenantId}:${conversationId}`;
  }

  async getTenantPlanTier(tenantId: string): Promise<PlanTier> {
    return this.plans.get(tenantId) ?? "TRIAL";
  }

  async getMonthlyUsage(
    tenantId: string,
    periodMonth: string,
  ): Promise<TenantUsageMetricsRecord | null> {
    return this.metrics.get(this.metricKey(tenantId, periodMonth)) ?? null;
  }

  async incrementUsageAndLog(
    params: IncrementUsageAndLogParams,
  ): Promise<TenantUsageMetricsRecord> {
    const key = this.metricKey(params.tenantId, params.periodMonth);
    const current = this.metrics.get(key) ?? {
      tenantId: params.tenantId,
      periodMonth: params.periodMonth,
      aiSessionsCount: 0,
      outboundMessagesCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: params.now,
    };

    const updated: TenantUsageMetricsRecord = {
      ...current,
      aiSessionsCount: current.aiSessionsCount + params.aiSessionsDelta,
      outboundMessagesCount:
        current.outboundMessagesCount + params.outboundMessagesDelta,
      totalInputTokens: current.totalInputTokens + params.promptTokens,
      totalOutputTokens: current.totalOutputTokens + params.completionTokens,
      updatedAt: params.now,
    };

    this.metrics.set(key, updated);
    this.logs.push(params);
    return updated;
  }

  async incrementAiSessionCount(
    tenantId: string,
    periodMonth: string,
    now: Date,
  ): Promise<TenantUsageMetricsRecord> {
    const key = this.metricKey(tenantId, periodMonth);
    const current = this.metrics.get(key) ?? {
      tenantId,
      periodMonth,
      aiSessionsCount: 0,
      outboundMessagesCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: now,
    };

    const updated: TenantUsageMetricsRecord = {
      ...current,
      aiSessionsCount: current.aiSessionsCount + 1,
      updatedAt: now,
    };

    this.metrics.set(key, updated);
    return updated;
  }

  async getConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
  ): Promise<Date | null> {
    return this.conversations.get(this.convKey(tenantId, conversationId)) ?? null;
  }

  async updateConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
    lastAiSessionAt: Date,
  ): Promise<boolean> {
    const key = this.convKey(tenantId, conversationId);
    if (!this.conversations.has(key)) {
      return false;
    }
    this.conversations.set(key, lastAiSessionAt);
    return true;
  }
}

describe("PlanQuotaGuardUseCase", () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const convId = "33333333-3333-4333-8333-333333333333";

  it("counts 1 AI session on first interaction, reuses within 6 hours, and opens a new session after 6 hours", async () => {
    const repo = new InMemoryTenantUsageRepository();
    repo.conversations.set(`${tenantA}:${convId}`, null);
    const useCase = new PlanQuotaGuardUseCase(repo);

    const t0 = new Date("2026-11-25T10:00:00.000Z");
    const first = await useCase.registerOrReuseAiSession({
      tenantId: tenantA,
      conversationId: convId,
      now: t0,
    });
    expect(first.allowed).toBe(true);
    expect(first.isNewSession).toBe(true);
    expect(first.usage.aiSessions.used).toBe(1);

    // 5h59m depois: ainda dentro da janela de 6h -> não consome nova sessão.
    const tWithin = new Date("2026-11-25T15:59:00.000Z");
    const reused = await useCase.registerOrReuseAiSession({
      tenantId: tenantA,
      conversationId: convId,
      now: tWithin,
    });
    expect(reused.allowed).toBe(true);
    expect(reused.isNewSession).toBe(false);
    expect(reused.usage.aiSessions.used).toBe(1);

    // 6h01m depois: expirou a janela -> consome nova sessão (+1).
    const tAfter = new Date("2026-11-25T16:01:00.000Z");
    const second = await useCase.registerOrReuseAiSession({
      tenantId: tenantA,
      conversationId: convId,
      now: tAfter,
    });
    expect(second.allowed).toBe(true);
    expect(second.isNewSession).toBe(true);
    expect(second.usage.aiSessions.used).toBe(2);
  });

  it("blocks AI sessions and outbound messages at 100% of plan quota and isolates tenants", async () => {
    const repo = new InMemoryTenantUsageRepository();
    repo.plans.set(tenantA, "TRIAL");
    repo.plans.set(tenantB, "PRO");
    const now = new Date("2026-11-25T12:00:00.000Z");

    repo.metrics.set(`${tenantA}:2026-11`, {
      tenantId: tenantA,
      periodMonth: "2026-11",
      aiSessionsCount: 20,
      outboundMessagesCount: 300,
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
      updatedAt: now,
    });

    const useCase = new PlanQuotaGuardUseCase(repo);

    const aiCheckA = await useCase.checkCanUseAiSession(tenantA, now);
    expect(aiCheckA.allowed).toBe(false);
    expect(aiCheckA.usage.isBlocked).toBe(true);
    expect(aiCheckA.usage.aiSessions.percentage).toBe(100);

    const outboundCheckA = await useCase.checkCanSendOutbound(tenantA, now);
    expect(outboundCheckA.allowed).toBe(false);
    expect(outboundCheckA.usage.outboundMessages.percentage).toBe(100);

    // Tenant B (Pro) continua completamente isolado e desbloqueado.
    const aiCheckB = await useCase.checkCanUseAiSession(tenantB, now);
    expect(aiCheckB.allowed).toBe(true);
    expect(aiCheckB.usage.planName).toBe("Pro");
    expect(aiCheckB.usage.aiSessions.limit).toBe(1500);
    expect(aiCheckB.usage.outboundMessages.limit).toBe(3000);
    expect(aiCheckB.usage.isBlocked).toBe(false);
  });

  it("records token usage atomically and writes audit log entries", async () => {
    const repo = new InMemoryTenantUsageRepository();
    const useCase = new PlanQuotaGuardUseCase(repo);
    const now = new Date("2026-11-25T14:00:00.000Z");

    const updated = await useCase.recordAiUsage({
      tenantId: tenantA,
      feature: "BOOKING",
      model: "gemini-2.5-flash",
      promptTokens: 450,
      completionTokens: 120,
      incrementSession: true,
      incrementOutbound: true,
      metadata: { conversationId: convId },
      now,
    });

    expect(updated.aiSessionsCount).toBe(1);
    expect(updated.outboundMessagesCount).toBe(1);
    expect(updated.totalInputTokens).toBe(450);
    expect(updated.totalOutputTokens).toBe(120);
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]?.feature).toBe("BOOKING");
  });

  it("rejects session registration when conversation does not belong to the authenticated tenant", async () => {
    const repo = new InMemoryTenantUsageRepository();
    repo.conversations.set(`${tenantA}:${convId}`, null);
    const useCase = new PlanQuotaGuardUseCase(repo);

    const result = await useCase.registerOrReuseAiSession({
      tenantId: tenantB,
      conversationId: convId,
      now: new Date("2026-11-25T10:00:00.000Z"),
    });

    expect(result.allowed).toBe(false);
    expect(result.isNewSession).toBe(false);
    expect(result.usage.aiSessions.used).toBe(0);
  });
});
