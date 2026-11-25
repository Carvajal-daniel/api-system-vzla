import crypto from "node:crypto";
import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getJwtSecret } from "../../../shared/config/env.js";
import {
  resetActorStatusVerifier,
  setActorStatusVerifier,
} from "../../../shared/http/auth/authenticate.js";
import { PlanQuotaGuardUseCase } from "../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type {
  AiUsageFeature,
  PlanTier,
  TenantUsageMetricsRecord,
} from "../../billing/domain/entities/tenant-usage.types.js";
import type {
  IncrementUsageAndLogParams,
  TenantUsageRepository,
} from "../../billing/domain/repositories/tenant-usage.repository.js";
import type {
  BusinessMetricsProviderPort,
  BusinessMetricsSnapshot,
} from "../../whatsapp/application/ports/business-metrics-provider.port.js";
import type {
  SendTextParams,
  WhatsAppGatewayPort,
} from "../../whatsapp/application/ports/whatsapp-gateway.port.js";
import type {
  CopilotStreamAiInput,
  CopilotStreamEvent,
  IntelligenceAiPort,
  ModuleAnalysisAiResult,
  ProactiveInsightsAiResult,
  RetentionMessagePromptInput,
} from "../application/ports/intelligence-ai.port.js";
import { AnalyzeModuleIntelligenceUseCase } from "../application/use-cases/analyze-module-intelligence.use-case.js";
import { GenerateDailyOwnerBriefingUseCase } from "../application/use-cases/generate-daily-owner-briefing.use-case.js";
import { ProactiveIntelligenceUseCase } from "../application/use-cases/proactive-intelligence.use-case.js";
import {
  RetentionClassifierUseCase,
  classifyInactiveClientTrack,
} from "../application/use-cases/retention-classifier.use-case.js";
import { StreamBusinessCopilotUseCase } from "../application/use-cases/stream-business-copilot.use-case.js";
import type {
  CreateProactiveInsightRecordInput,
  DailyBriefingSnapshot,
  InactiveClientCandidate,
  IntelligenceModule,
  ModuleMetricsPayload,
  ProactiveInsightRecord,
  ProactiveScanMetrics,
} from "../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../domain/repositories/intelligence-data.repository.js";
import type {
  ListProactiveInsightsParams,
  ListProactiveInsightsResult,
  ProactiveInsightsRepository,
} from "../domain/repositories/proactive-insights.repository.js";
import { buildDeterministicProactiveInsights } from "../infra/ai/gemini-intelligence.adapter.js";
import { intelligenceRoutes } from "../infra/http/intelligence.routes.js";

class InMemoryTenantUsageRepository implements TenantUsageRepository {
  public readonly logs: IncrementUsageAndLogParams[] = [];
  private readonly usageByTenant = new Map<
    string,
    { aiSessions: number; outboundMessages: number }
  >();
  private readonly planByTenant = new Map<string, PlanTier>();

  public setPlan(tenantId: string, plan: PlanTier): void {
    this.planByTenant.set(tenantId, plan);
  }

  public setUsage(
    tenantId: string,
    usage: { aiSessions: number; outboundMessages: number },
  ): void {
    this.usageByTenant.set(tenantId, usage);
  }

  public async getTenantPlanTier(tenantId: string): Promise<PlanTier> {
    return this.planByTenant.get(tenantId) ?? "PRO";
  }

  public async getMonthlyUsage(
    tenantId: string,
    periodMonth: string,
  ): Promise<TenantUsageMetricsRecord | null> {
    const current = this.usageByTenant.get(tenantId) ?? {
      aiSessions: 0,
      outboundMessages: 0,
    };
    return {
      tenantId,
      periodMonth,
      aiSessionsCount: current.aiSessions,
      outboundMessagesCount: current.outboundMessages,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: new Date(),
    };
  }

  public async getConversationLastAiSessionAt(): Promise<Date | null> {
    return null;
  }

  public async updateConversationLastAiSessionAt(): Promise<boolean> {
    return true;
  }

  public async incrementAiSessionCount(): Promise<TenantUsageMetricsRecord> {
    throw new Error("not used in stage3 test");
  }

  public async incrementUsageAndLog(
    input: IncrementUsageAndLogParams,
  ): Promise<TenantUsageMetricsRecord> {
    this.logs.push(input);
    const current = this.usageByTenant.get(input.tenantId) ?? {
      aiSessions: 0,
      outboundMessages: 0,
    };
    current.aiSessions += input.aiSessionsDelta;
    current.outboundMessages += input.outboundMessagesDelta;
    this.usageByTenant.set(input.tenantId, current);
    return {
      tenantId: input.tenantId,
      periodMonth: input.periodMonth,
      aiSessionsCount: current.aiSessions,
      outboundMessagesCount: current.outboundMessages,
      totalInputTokens: input.promptTokens,
      totalOutputTokens: input.completionTokens,
      updatedAt: input.now,
    };
  }
}

class InMemoryProactiveInsightsRepository
  implements ProactiveInsightsRepository
{
  public readonly records: ProactiveInsightRecord[] = [];

  public async listByTenant(
    params: ListProactiveInsightsParams,
  ): Promise<ListProactiveInsightsResult> {
    const tenantItems = this.records.filter(
      (r) => r.tenantId === params.tenantId,
    );
    const pendingCount = tenantItems.filter(
      (r) => r.status === "PENDING",
    ).length;
    const filtered = tenantItems.filter((r) => {
      if (params.module && r.module !== params.module) return false;
      if (params.status && r.status !== params.status) return false;
      return true;
    });
    return { insights: filtered, pendingCount };
  }

  public async findByIdForTenant(
    tenantId: string,
    insightId: string,
  ): Promise<ProactiveInsightRecord | null> {
    return (
      this.records.find(
        (r) => r.tenantId === tenantId && r.id === insightId,
      ) ?? null
    );
  }

  public async existsPendingTodayByType(
    tenantId: string,
    type: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return this.records.some(
      (r) =>
        r.tenantId === tenantId &&
        r.type === type &&
        r.status === "PENDING" &&
        r.createdAt >= startOfDay,
    );
  }

  public async create(
    input: CreateProactiveInsightRecordInput,
  ): Promise<ProactiveInsightRecord> {
    const record: ProactiveInsightRecord = {
      id: crypto.randomUUID(),
      tenantId: input.tenantId,
      module: input.module,
      type: input.type,
      title: input.title,
      description: input.description,
      impactLabel: input.impactLabel ?? null,
      actionPayload: input.actionPayload ?? null,
      status: "PENDING",
      expiresAt: input.expiresAt ?? null,
      createdAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  public async updateStatusForTenant(
    tenantId: string,
    insightId: string,
    status: "PENDING" | "EXECUTED" | "DISMISSED",
  ): Promise<ProactiveInsightRecord | null> {
    const record = this.records.find(
      (r) => r.tenantId === tenantId && r.id === insightId,
    );
    if (!record) return null;
    record.status = status;
    return record;
  }
}

class FakeWhatsAppGateway implements WhatsAppGatewayPort {
  public readonly sentTexts: SendTextParams[] = [];

  public async sendText(params: SendTextParams) {
    this.sentTexts.push(params);
    return { externalMessageId: `msg-${this.sentTexts.length}` };
  }

  public async sendTemplate() {
    return { externalMessageId: "tpl-1" };
  }

  public async sendPresence() {}

  public async getChannelsStatus() {
    return [];
  }
}

class FakeIntelligenceAiPort implements IntelligenceAiPort {
  public async generateRetentionMessage(input: RetentionMessagePromptInput) {
    return {
      text: `[${input.track}] Olá ${input.client.clientName} (${input.client.lastServiceName ?? "serviço"})`,
      usage: {
        model: "gemini-3.5-flash-lite",
        promptTokens: 80,
        completionTokens: 35,
      },
    };
  }

  public async generateProactiveInsights(
    metrics: ProactiveScanMetrics,
  ): Promise<ProactiveInsightsAiResult> {
    return {
      insights: buildDeterministicProactiveInsights(metrics),
      usage: {
        model: "gemini-3.5-flash-lite",
        promptTokens: 150,
        completionTokens: 90,
      },
    };
  }

  public async analyzeModule(
    payload: ModuleMetricsPayload,
  ): Promise<ModuleAnalysisAiResult> {
    return {
      analysis: {
        module: payload.module,
        headline: `Análise rápida de ${payload.module} para ${payload.companyName}`,
        insights: [
          {
            title: "Indicador principal",
            detail: `Dados processados em ${payload.referenceDate}`,
            severity: "OPPORTUNITY",
          },
        ],
        recommendedAction: "Executar ação recomendada no módulo.",
        provider: "GEMINI",
      },
      usage: {
        model: "gemini-3.5-flash-lite",
        promptTokens: 110,
        completionTokens: 60,
      },
    };
  }

  public async *streamCopilot(
    input: CopilotStreamAiInput,
  ): AsyncGenerator<CopilotStreamEvent> {
    const chunks = [
      `Olá! `,
      `No módulo ${input.currentModule ?? "GERAL"} `,
      `da ${input.globalMetrics.companyName}, `,
      `o faturamento de hoje está em R$ ${(input.globalMetrics.revenue.todayCents / 100).toFixed(2)}.`,
    ];
    for (const text of chunks) {
      yield { type: "chunk", text };
    }
    yield {
      type: "usage",
      usage: {
        model: "gemini-3.5-flash-lite",
        promptTokens: 200,
        completionTokens: 45,
      },
    };
  }
}

function buildScanMetrics(tenantId: string): ProactiveScanMetrics {
  return {
    companyId: tenantId,
    companyName: "Barbearia Prime",
    referenceDate: "2026-11-25",
    agendaGaps: [
      {
        collaboratorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        collaboratorName: "Carlos Silva",
        totalAvailableMinutes48h: 960,
        bookedMinutes48h: 240,
        idlePercentage: 75,
        habitualClients: [
          { clientName: "Marcos", clientPhone: "+5511999991111" },
          { clientName: "Lucas", clientPhone: "+5511999992222" },
        ],
      },
    ],
    finance: {
      currentWeekRevenueCents: 300_000,
      previousWeekRevenueCents: 450_000,
      revenueDeltaPercent: -33,
      currentWeekAvgTicketCents: 7_500,
      previousWeekAvgTicketCents: 8_200,
      currentWeekOrdersCount: 40,
      previousWeekOrdersCount: 55,
      pendingExpensesCents: 50_000,
      peakDayOfWeek: "Sábado",
    },
    serviceCombos: [
      { serviceA: "Barba", serviceB: "Corte Degradê", coOccurrenceCount: 9 },
    ],
    inventory: {
      lowStockItems: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Pomada Matte",
          currentStock: 1,
          minStock: 5,
        },
      ],
      stagnantItems60d: [],
    },
    team: [
      {
        collaboratorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        collaboratorName: "Carlos Silva",
        completedAppointments30d: 45,
        returnRatePercent: 68,
        averageRating: 4.9,
        reviewsCount: 15,
        idlePercentage48h: 75,
      },
    ],
    clients: {
      totalClients: 120,
      inactive30dCount: 18,
      avgTotalSpentCents: 24_000,
      recentUnhappyReviewsCount: 1,
    },
  };
}

describe("Stage 3 — Retention 3-Track Classifier", () => {
  const tenantId = "11111111-1111-4111-8111-111111111111";

  it("classifies satisfied, canceled and unhappy clients into the 3 tracks and NEVER auto-sends to unhappy clients (rating 1-3)", async () => {
    const candidates: InactiveClientCandidate[] = [
      {
        clientId: "c1",
        clientName: "João Satisfeito",
        clientPhone: "+5511988881111",
        lastCompletedAt: new Date("2026-10-01T12:00:00Z"),
        daysSinceLastVisit: 55,
        lastAppointmentStatus: "COMPLETED",
        lastCancellationReason: null,
        lastServiceName: "Corte Degradê",
        preferredCollaboratorName: "Carlos",
        lastReviewRating: 5,
        lastReviewComment: "Excelente!",
      },
      {
        clientId: "c2",
        clientName: "Pedro Cancelou",
        clientPhone: "+5511988882222",
        lastCompletedAt: new Date("2026-09-20T12:00:00Z"),
        daysSinceLastVisit: 66,
        lastAppointmentStatus: "CANCELED",
        lastCancellationReason: "Imprevisto no trabalho",
        lastServiceName: "Barba",
        preferredCollaboratorName: "Carlos",
        lastReviewRating: null,
        lastReviewComment: null,
      },
      {
        clientId: "c3",
        clientName: "Rafael Insatisfeito",
        clientPhone: "+5511988883333",
        lastCompletedAt: new Date("2026-10-10T12:00:00Z"),
        daysSinceLastVisit: 46,
        lastAppointmentStatus: "COMPLETED",
        lastCancellationReason: null,
        lastServiceName: "Corte Social",
        preferredCollaboratorName: "Lucas",
        lastReviewRating: 2,
        lastReviewComment: "Demorou muito para atender",
      },
    ];

    expect(classifyInactiveClientTrack(candidates[0]!)).toBe(
      "TRACK_1_SATISFIED",
    );
    expect(classifyInactiveClientTrack(candidates[1]!)).toBe(
      "TRACK_2_CANCELED",
    );
    expect(classifyInactiveClientTrack(candidates[2]!)).toBe("TRACK_3_UNHAPPY");

    const dataRepo: IntelligenceDataRepository = {
      listActiveTenantIds: async () => [tenantId],
      findInactiveClientsForRetention: async () => candidates,
      getProactiveScanMetrics: async () => buildScanMetrics(tenantId),
      getModuleAggregatedMetrics: async (_t, module) => ({
        module,
        companyName: "Barbearia Prime",
        referenceDate: "2026-11-25",
        metrics: {},
      }),
      getDailyBriefingSnapshot: async () => ({
        companyId: tenantId,
        companyName: "Barbearia Prime",
        companyTimezone: "America/Sao_Paulo",
        ownerPhone: "+5511999990000",
        referenceDate: "2026-11-25",
        confirmedAppointmentsToday: 12,
        pendingAppointmentsToday: 2,
        projectedRevenueTodayCents: 98_000,
        criticalIdleSlotsCount: 1,
        criticalIdleSummary: ["Carlos Silva (75% livre)"],
        pendingInsightsCount: 3,
      }),
    };

    const insightsRepo = new InMemoryProactiveInsightsRepository();
    const usageRepo = new InMemoryTenantUsageRepository();
    const quotaGuard = new PlanQuotaGuardUseCase(usageRepo);
    const gateway = new FakeWhatsAppGateway();
    const aiPort = new FakeIntelligenceAiPort();
    const sleepCalls: number[] = [];

    const useCase = new RetentionClassifierUseCase(
      dataRepo,
      insightsRepo,
      aiPort,
      gateway,
      quotaGuard,
      undefined,
      undefined,
      {
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
        randomDripDelayMs: () => 60_000,
      },
    );

    const result = await useCase.executeForTenant(tenantId);

    expect(result.scannedCount).toBe(3);
    expect(result.track1SentCount).toBe(1);
    expect(result.track2SentCount).toBe(1);
    expect(result.track3CardsCreatedCount).toBe(1);

    // Garantia crítica: apenas Track 1 e Track 2 receberam disparo automático; Track 3 (nota 2) foi bloqueado!
    expect(gateway.sentTexts).toHaveLength(2);
    expect(gateway.sentTexts.map((m) => m.to)).toEqual([
      "+5511988881111",
      "+5511988882222",
    ]);
    // Gotejamento seguro acionado entre o 1º e o 2º disparo
    expect(sleepCalls).toEqual([60_000]);

    // Track 3 gerou card PENDING para aprovação manual do dono
    expect(insightsRepo.records).toHaveLength(1);
    expect(insightsRepo.records[0]).toMatchObject({
      tenantId,
      module: "CLIENTS",
      type: "UNHAPPY_CLIENT_RESCUE",
      status: "PENDING",
    });
    expect(insightsRepo.records[0]?.actionPayload).toMatchObject({
      actionType: "SEND_APOLOGY_WHATSAPP",
      clientId: "c3",
      rating: 2,
    });

    // Todos os registros de uso foram gravados com feature RETENTION
    expect(
      usageRepo.logs.every(
        (log) => log.feature === ("RETENTION" satisfies AiUsageFeature),
      ),
    ).toBe(true);
  });
});

describe("Stage 3 — Proactive Insights, Module Analysis, Copilot SSE & Daily Briefing (HTTP + Multi-Tenant)", () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const userA = "99999999-9999-4999-8999-999999999991";
  const userB = "99999999-9999-4999-8999-999999999992";

  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "test-intelligence-jwt-secret");
    setActorStatusVerifier(async () => true);
  });

  afterEach(() => {
    resetActorStatusVerifier();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  function signOwnerToken(sub: string, companyId: string): string {
    return jwt.sign({ sub, companyId, role: "OWNER" }, getJwtSecret());
  }

  it("enforces tenant isolation on insights refresh/list/execute/dismiss, runs module analysis and streams Copilot SSE", async () => {
    const insightsRepo = new InMemoryProactiveInsightsRepository();
    const usageRepo = new InMemoryTenantUsageRepository();
    const quotaGuard = new PlanQuotaGuardUseCase(usageRepo);
    const gateway = new FakeWhatsAppGateway();
    const aiPort = new FakeIntelligenceAiPort();

    const dataRepo: IntelligenceDataRepository = {
      listActiveTenantIds: async () => [tenantA, tenantB],
      findInactiveClientsForRetention: async () => [],
      getProactiveScanMetrics: async (tid) => buildScanMetrics(tid),
      getModuleAggregatedMetrics: async (_tid, module: IntelligenceModule) => ({
        module,
        companyName: "Barbearia Prime",
        referenceDate: "2026-11-25",
        metrics: { sample: true },
      }),
      getDailyBriefingSnapshot: async (tid): Promise<DailyBriefingSnapshot> => ({
        companyId: tid,
        companyName: "Barbearia Prime",
        companyTimezone: "America/Sao_Paulo",
        ownerPhone: "+5511999990000",
        referenceDate: "2026-11-25",
        confirmedAppointmentsToday: 10,
        pendingAppointmentsToday: 2,
        projectedRevenueTodayCents: 120_000,
        criticalIdleSlotsCount: 1,
        criticalIdleSummary: ["Carlos Silva (75% livre)"],
        pendingInsightsCount: 5,
      }),
    };

    const metricsProvider: BusinessMetricsProviderPort = {
      getSnapshot: async (): Promise<BusinessMetricsSnapshot> => ({
        companyName: "Barbearia Prime",
        currency: "BRL",
        referenceDate: "2026-11-25",
        revenue: {
          todayCents: 85_000,
          monthCents: 1_450_000,
          openOrdersCount: 2,
          openOrdersTotalCents: 19_000,
        },
        appointments: {
          todayTotal: 12,
          todayConfirmed: 10,
          todayCompleted: 4,
          monthTotal: 210,
          monthCompleted: 185,
          monthCanceled: 15,
          monthNoShow: 10,
        },
        commissions: { pendingCount: 4, pendingTotalCents: 32_000 },
        clients: { totalClients: 120, inactive30dCount: 18 },
        whatsapp: {
          totalConversations30d: 80,
          convertedConversations30d: 36,
          conversionRatePercent: 45,
          stalledConversations24h: 3,
          hotLeadsCount: 7,
          topObjection: "PRICE",
        },
      }),
    };

    const proactiveUseCase = new ProactiveIntelligenceUseCase(
      dataRepo,
      insightsRepo,
      aiPort,
      gateway,
      quotaGuard,
    );
    const analyzeModuleUseCase = new AnalyzeModuleIntelligenceUseCase(
      dataRepo,
      aiPort,
      quotaGuard,
    );
    const streamCopilotUseCase = new StreamBusinessCopilotUseCase(
      metricsProvider,
      dataRepo,
      aiPort,
      quotaGuard,
    );

    const app = fastify();
    await app.register(fastifySwagger, {
      openapi: {
        openapi: "3.1.0",
        info: { title: "Intelligence Test API", version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
      },
    });
    await app.register(intelligenceRoutes, {
      proactiveIntelligenceUseCase: proactiveUseCase,
      analyzeModuleUseCase,
      streamCopilotUseCase,
    });
    await app.ready();

    const tokenA = signOwnerToken(userA, tenantA);
    const tokenB = signOwnerToken(userB, tenantB);

    // 1. Refresh para Tenant A cria 5 cards (AGENDA, FINANCE, SERVICES, INVENTORY, TEAM)
    const refresh1 = await app.inject({
      method: "POST",
      url: "/v1/intelligence/insights/refresh",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(refresh1.statusCode).toBe(200);
    expect(refresh1.json().createdCount).toBe(5);

    // 2. Refresh repetido no mesmo dia não duplica cards PENDING do mesmo type
    const refresh2 = await app.inject({
      method: "POST",
      url: "/v1/intelligence/insights/refresh",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(refresh2.statusCode).toBe(200);
    expect(refresh2.json().createdCount).toBe(0);
    expect(refresh2.json().skippedDuplicateCount).toBe(5);

    // 3. Listagem retorna pendingCount correto para Tenant A e 0 para Tenant B (isolamento multi-tenant)
    const listA = await app.inject({
      method: "GET",
      url: "/v1/intelligence/insights",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listA.statusCode).toBe(200);
    expect(listA.json().pendingCount).toBe(5);

    const listB = await app.inject({
      method: "GET",
      url: "/v1/intelligence/insights",
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listB.statusCode).toBe(200);
    expect(listB.json().pendingCount).toBe(0);
    expect(listB.json().insights).toHaveLength(0);

    // 4. Tenant B NÃO consegue executar nem descartar insight do Tenant A (404)
    const agendaInsight = listA
      .json()
      .insights.find((i: ProactiveInsightRecord) => i.module === "AGENDA");
    const financeInsight = listA
      .json()
      .insights.find((i: ProactiveInsightRecord) => i.module === "FINANCE");

    const crossExecute = await app.inject({
      method: "POST",
      url: `/v1/intelligence/insights/${agendaInsight.id}/execute`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossExecute.statusCode).toBe(404);

    const crossDismiss = await app.inject({
      method: "POST",
      url: `/v1/intelligence/insights/${financeInsight.id}/dismiss`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(crossDismiss.statusCode).toBe(404);

    // 5. Tenant A executa o insight de AGENDA (dispara WhatsApp para clientes habituais) e descarta FINANCE
    const execA = await app.inject({
      method: "POST",
      url: `/v1/intelligence/insights/${agendaInsight.id}/execute`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(execA.statusCode).toBe(200);
    expect(execA.json().insight.status).toBe("EXECUTED");
    expect(execA.json().dispatchedMessagesCount).toBe(2);
    expect(gateway.sentTexts).toHaveLength(2);

    const dismissA = await app.inject({
      method: "POST",
      url: `/v1/intelligence/insights/${financeInsight.id}/dismiss`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(dismissA.statusCode).toBe(200);
    expect(dismissA.json().insight.status).toBe("DISMISSED");

    const listAfterA = await app.inject({
      method: "GET",
      url: "/v1/intelligence/insights",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(listAfterA.json().pendingCount).toBe(3);

    // 6. Análise instantânea por módulo
    const moduleRes = await app.inject({
      method: "POST",
      url: "/v1/intelligence/modules/FINANCE/analyze",
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(moduleRes.statusCode).toBe(200);
    expect(moduleRes.json()).toMatchObject({
      module: "FINANCE",
      provider: "GEMINI",
    });
    expect(
      usageRepo.logs.some((log) => log.feature === "MODULE_ANALYSIS"),
    ).toBe(true);

    // 7. Copiloto IA com Streaming SSE
    const sseRes = await app.inject({
      method: "POST",
      url: "/v1/intelligence/copilot/stream",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        message: "Como está meu caixa hoje?",
        currentModule: "FINANCE",
      },
    });
    expect(sseRes.statusCode).toBe(200);
    expect(sseRes.headers["content-type"]).toContain("text/event-stream");
    expect(sseRes.body).toContain('data: {"chunk":');
    expect(sseRes.body).toContain("FINANCE");
    expect(sseRes.body).toContain('data: {"done":true}');
    expect(usageRepo.logs.some((log) => log.feature === "COPILOT")).toBe(true);

    // 8. Briefing Diário do Dono
    const briefingUseCase = new GenerateDailyOwnerBriefingUseCase(
      dataRepo,
      gateway,
      quotaGuard,
    );
    const briefingRes = await briefingUseCase.executeForTenant(tenantA);
    expect(briefingRes.status).toBe("SENT");
    expect(briefingRes.message).toContain("10 confirmados");
    expect(briefingRes.message).toContain("Insights proativos pendentes: *5*");

    // 9. Documentação OpenAPI/Swagger exposta corretamente
    const spec = app.swagger();
    expect(spec.paths?.["/v1/intelligence/insights"]).toBeDefined();
    expect(spec.paths?.["/v1/intelligence/insights/{id}/execute"]).toBeDefined();
    expect(spec.paths?.["/v1/intelligence/modules/{module}/analyze"]).toBeDefined();
    expect(spec.paths?.["/v1/intelligence/copilot/stream"]).toBeDefined();

    await app.close();
  });
});
