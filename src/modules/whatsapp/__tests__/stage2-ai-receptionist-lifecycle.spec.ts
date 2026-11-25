import { afterEach, describe, expect, it, vi } from "vitest";
import { PlanQuotaGuardUseCase } from "../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type {
  PlanTier,
  TenantUsageMetricsRecord,
} from "../../billing/domain/entities/tenant-usage.types.js";
import type {
  IncrementUsageAndLogParams,
  TenantUsageRepository,
} from "../../billing/domain/repositories/tenant-usage.repository.js";
import type { ClientsRepository } from "../../clients/domain/repositories/clients.repository.js";
import { Client } from "../../clients/domain/entities/client.entity.js";
import {
  WhatsAppConversation,
  type WhatsAppAssignedMode,
  type WhatsAppConversationStatus,
} from "../domain/entities/whatsapp-conversation.entity.js";
import { WhatsAppMessage } from "../domain/entities/whatsapp-message.entity.js";
import type { CompanyWhatsAppConnectionRepository } from "../domain/repositories/company-whatsapp-connection.repository.js";
import type {
  AppointmentRemindersRepository,
  PendingReminderAppointment,
  ReminderWindowType,
} from "../domain/repositories/appointment-reminders.repository.js";
import type {
  EligibleNpsAppointment,
  PendingNpsAppointment,
  PostVisitNpsRepository,
} from "../domain/repositories/post-visit-nps.repository.js";
import type { WhatsAppConversationsRepository } from "../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../domain/repositories/whatsapp-messages.repository.js";
import type {
  AiBookingAgentInput,
  AiBookingAgentOutput,
  AiBookingAgentPort,
  AiBookingToolExecutor,
} from "../application/ports/ai-booking-agent.port.js";
import type { AiBookingContextProviderPort } from "../application/ports/ai-booking-context-provider.port.js";
import type {
  CreateProactiveInsightInput,
  ProactiveInsightsWriterPort,
} from "../application/ports/proactive-insights-writer.port.js";
import type {
  SendPresenceParams,
  SendTextParams,
  WhatsAppGatewayPort,
} from "../application/ports/whatsapp-gateway.port.js";
import { WhatsAppAiTurnOrchestrator } from "../application/services/whatsapp-ai-turn-orchestrator.js";
import { ManageWhatsAppConversationAiPauseUseCase } from "../application/use-cases/manage-whatsapp-conversation-ai-pause.use-case.js";
import { ProcessAppointmentRemindersUseCase } from "../application/use-cases/process-appointment-reminders.use-case.js";
import {
  ANTI_SPAM_FIXED_REPLY,
  ProcessInboundWhatsAppMessageUseCase,
} from "../application/use-cases/process-inbound-whatsapp-message.use-case.js";
import { ProcessPostVisitNpsUseCase } from "../application/use-cases/process-post-visit-nps.use-case.js";
import { buildAiBookingSystemPrompt } from "../infra/ai/ai-booking-tool-definitions.js";
import { GeminiBookingAgentAdapter } from "../infra/ai/gemini-booking-agent.adapter.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

class InMemoryConversationsRepo implements WhatsAppConversationsRepository {
  public readonly items = new Map<string, WhatsAppConversation>();

  private key(companyId: string, id: string): string {
    return `${companyId}:${id}`;
  }

  async findById(companyId: string, conversationId: string) {
    return this.items.get(this.key(companyId, conversationId)) ?? null;
  }

  async findByCompanyAndPhone(companyId: string, normalizedPhone: string) {
    for (const item of this.items.values()) {
      if (item.companyId === companyId && item.phone === normalizedPhone) {
        return item;
      }
    }
    return null;
  }

  async upsertInbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    incrementUnread: boolean;
  }) {
    const existing = await this.findByCompanyAndPhone(
      input.companyId,
      input.phone,
    );
    if (existing) {
      const updated = WhatsAppConversation.restore({
        ...existing.toPersistence(),
        lastMessageAt: input.sentAt,
        unreadCount: existing.unreadCount + (input.incrementUnread ? 1 : 0),
        updatedAt: input.sentAt,
      });
      this.items.set(this.key(input.companyId, updated.id), updated);
      return updated;
    }

    const created = WhatsAppConversation.create({
      companyId: input.companyId,
      phone: input.phone,
      clientId: input.clientId,
      contactName: input.contactName,
      unreadCount: input.incrementUnread ? 1 : 0,
      now: input.sentAt,
    });
    this.items.set(this.key(input.companyId, created.id), created);
    return created;
  }

  async upsertOutbound(input: {
    companyId: string;
    phone: string;
    clientId: string | null;
    contactName: string | null;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode;
    status?: WhatsAppConversationStatus;
  }) {
    const existing = await this.findByCompanyAndPhone(
      input.companyId,
      input.phone,
    );
    if (existing) {
      const updated = WhatsAppConversation.restore({
        ...existing.toPersistence(),
        assignedMode: input.assignedMode ?? existing.assignedMode,
        status: input.status ?? existing.status,
        lastMessageAt: input.sentAt,
        updatedAt: input.sentAt,
      });
      this.items.set(this.key(input.companyId, updated.id), updated);
      return updated;
    }

    const created = WhatsAppConversation.create({
      companyId: input.companyId,
      phone: input.phone,
      clientId: input.clientId,
      contactName: input.contactName,
      assignedMode: input.assignedMode ?? "AI_AUTOPILOT",
      status: input.status ?? "WAITING_CLIENT",
      now: input.sentAt,
    });
    this.items.set(this.key(input.companyId, created.id), created);
    return created;
  }

  async listByCompany() {
    return [];
  }

  async resetUnreadCount() {}

  async updateAssignedMode(
    companyId: string,
    conversationId: string,
    assignedMode: WhatsAppAssignedMode,
  ) {
    const existing = await this.findById(companyId, conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      assignedMode,
    });
    this.items.set(this.key(companyId, updated.id), updated);
    return updated;
  }

  async updateStatus(
    companyId: string,
    conversationId: string,
    status: WhatsAppConversationStatus,
  ) {
    const existing = await this.findById(companyId, conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      status,
    });
    this.items.set(this.key(companyId, updated.id), updated);
    return updated;
  }

  async touchAfterOutbound(input: {
    companyId: string;
    conversationId: string;
    sentAt: Date;
    assignedMode?: WhatsAppAssignedMode;
    status?: WhatsAppConversationStatus;
  }) {
    const existing = await this.findById(input.companyId, input.conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      lastMessageAt: input.sentAt,
      assignedMode: input.assignedMode ?? existing.assignedMode,
      status: input.status ?? existing.status,
    });
    this.items.set(this.key(input.companyId, updated.id), updated);
    return updated;
  }

  async updateAiPauseState(input: {
    companyId: string;
    conversationId: string;
    aiPausedUntil: Date | null;
    assignedMode?: WhatsAppAssignedMode;
  }) {
    const existing = await this.findById(input.companyId, input.conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      aiPausedUntil: input.aiPausedUntil,
      assignedMode: input.assignedMode ?? existing.assignedMode,
    });
    this.items.set(this.key(input.companyId, updated.id), updated);
    return updated;
  }

  async updateHourlyRateLimit(input: {
    companyId: string;
    conversationId: string;
    hourlyMessageCount: number;
    hourlyWindowStartAt: Date | null;
  }) {
    const existing = await this.findById(input.companyId, input.conversationId);
    if (!existing) return null;
    const updated = WhatsAppConversation.restore({
      ...existing.toPersistence(),
      hourlyMessageCount: input.hourlyMessageCount,
      hourlyWindowStartAt: input.hourlyWindowStartAt,
    });
    this.items.set(this.key(input.companyId, updated.id), updated);
    return updated;
  }
}

class InMemoryMessagesRepo implements WhatsAppMessagesRepository {
  public readonly messages: WhatsAppMessage[] = [];

  async findByExternalMessageId(companyId: string, externalMessageId: string) {
    return (
      this.messages.find(
        (m) =>
          m.companyId === companyId &&
          m.externalMessageId === externalMessageId,
      ) ?? null
    );
  }

  async createIdempotent(message: WhatsAppMessage) {
    if (message.externalMessageId) {
      const existing = await this.findByExternalMessageId(
        message.companyId,
        message.externalMessageId,
      );
      if (existing) {
        return { message: existing, created: false };
      }
    }
    this.messages.push(message);
    return { message, created: true };
  }

  async listByConversation(companyId: string, conversationId: string, limit = 100) {
    return this.messages
      .filter(
        (m) => m.companyId === companyId && m.conversationId === conversationId,
      )
      .slice(-limit);
  }

  async listRecentByConversation(
    companyId: string,
    conversationId: string,
    limit: number,
  ) {
    return this.listByConversation(companyId, conversationId, limit);
  }
}

class InMemoryUsageRepo implements TenantUsageRepository {
  public readonly metrics = new Map<string, TenantUsageMetricsRecord>();
  public readonly logs: IncrementUsageAndLogParams[] = [];
  public readonly plans = new Map<string, PlanTier>();
  public readonly lastSessions = new Map<string, Date | null>();

  async getTenantPlanTier(tenantId: string): Promise<PlanTier> {
    return this.plans.get(tenantId) ?? "PRO";
  }

  async getMonthlyUsage(tenantId: string, periodMonth: string) {
    return this.metrics.get(`${tenantId}:${periodMonth}`) ?? null;
  }

  async getConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
  ) {
    return this.lastSessions.get(`${tenantId}:${conversationId}`) ?? null;
  }

  async updateConversationLastAiSessionAt(
    tenantId: string,
    conversationId: string,
    lastAiSessionAt: Date,
  ) {
    this.lastSessions.set(`${tenantId}:${conversationId}`, lastAiSessionAt);
    return true;
  }

  async incrementAiSessionCount(
    tenantId: string,
    periodMonth: string,
    now: Date,
  ) {
    const key = `${tenantId}:${periodMonth}`;
    const existing = this.metrics.get(key) ?? {
      tenantId,
      periodMonth,
      aiSessionsCount: 0,
      outboundMessagesCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: now,
    };
    const updated = {
      ...existing,
      aiSessionsCount: existing.aiSessionsCount + 1,
      updatedAt: now,
    };
    this.metrics.set(key, updated);
    return updated;
  }

  async incrementUsageAndLog(params: IncrementUsageAndLogParams) {
    this.logs.push(params);
    const key = `${params.tenantId}:${params.periodMonth}`;
    const existing = this.metrics.get(key) ?? {
      tenantId: params.tenantId,
      periodMonth: params.periodMonth,
      aiSessionsCount: 0,
      outboundMessagesCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: params.now,
    };
    const updated = {
      ...existing,
      aiSessionsCount: existing.aiSessionsCount + params.aiSessionsDelta,
      outboundMessagesCount:
        existing.outboundMessagesCount + params.outboundMessagesDelta,
      totalInputTokens: existing.totalInputTokens + params.promptTokens,
      totalOutputTokens: existing.totalOutputTokens + params.completionTokens,
      updatedAt: params.now,
    };
    this.metrics.set(key, updated);
    return updated;
  }
}

function createFakeGateway() {
  const events: Array<{ type: "presence" | "text"; payload: unknown }> = [];
  const gateway: WhatsAppGatewayPort = {
    sendText: vi.fn(async (params: SendTextParams) => {
      events.push({ type: "text", payload: params });
      return { externalMessageId: `msg-${events.length}` };
    }),
    sendTemplate: vi.fn(async () => ({ externalMessageId: "tpl-1" })),
    sendPresence: vi.fn(async (params: SendPresenceParams) => {
      events.push({ type: "presence", payload: params });
    }),
    getChannelsStatus: vi.fn(async () => []),
  };
  return { gateway, events };
}

function createClientsRepo(): ClientsRepository {
  const byKey = new Map<string, Client>();
  return {
    findById: async () => null,
    findByPhone: async (companyId: string, phone: string) =>
      byKey.get(`${companyId}:${phone}`) ?? null,
    create: async (client: Client) => {
      byKey.set(`${client.companyId}:${client.phone}`, client);
      return client;
    },
    update: async (client: Client) => client,
    listByCompany: async () => [],
  } as unknown as ClientsRepository;
}

function createConnectionsRepo(): CompanyWhatsAppConnectionRepository {
  return {
    findByCompanyId: async () => null,
    findByEvolutionInstanceName: async () => null,
    upsert: async (c) => c,
  };
}

function createContextProvider(): AiBookingContextProviderPort {
  const tools: AiBookingToolExecutor = {
    listServicesAndProfessionals: async () => ({ services: [], collaborators: [] }),
    checkAvailability: async () => ({
      date: "2026-11-26",
      timezone: "America/Sao_Paulo",
      serviceDurationMinutes: 30,
      slots: [],
    }),
    listCustomerUpcomingAppointments: async () => ({ appointments: [] }),
    createAppointment: async () => ({
      success: false,
      error: "indisponível",
      availableSlots: [],
    }),
    rescheduleAppointment: async () => ({
      id: "a1",
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      status: "CONFIRMED",
      collaboratorId: "c1",
    }),
    cancelAppointment: async () => ({ id: "a1", status: "CANCELED" }),
    requestHumanHandoff: async ({ reason }) => ({
      handoff: true as const,
      reason: reason ?? "Solicitado",
    }),
  };

  return {
    buildContextAndTools: async (input) => ({
      company: {
        companyId: input.companyId,
        companyName: "Barbearia Prime",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: input.aiSystemPrompt,
        services: [],
        collaborators: [],
      },
      tools,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Stage 2 — Block 1: Enriched Context, 10-message Sliding Window & Gemini Limits", () => {
  it("injects operational rules and customer history without financial metrics", () => {
    const prompt = buildAiBookingSystemPrompt({
      company: {
        companyId: TENANT_A,
        companyName: "Barbearia Prime",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: "Seja simpático e direto.",
        services: [
          { id: "s1", name: "Corte", durationMinutes: 30, priceInCents: 5000 },
        ],
        collaborators: [
          { id: "c1", name: "Lucas", specialty: "Degradê", serviceIds: ["s1"] },
        ],
        operationalRules: {
          address: "Av. Paulista, 1000 · Bela Vista · São Paulo - SP",
          googleMapsUrl: "https://maps.app.goo.gl/prime",
          paymentMethods: "Pagamento online/PIX ativo (EVP)",
          delayPolicy: "Tolerância máxima de 10 minutos.",
          packageNotes: "Clube mensal com 4 cortes.",
        },
        customerContext: {
          registeredName: "João Silva",
          lastCompletedVisit: {
            localDate: "2026-11-10",
            serviceName: "Corte",
            collaboratorName: "Lucas",
          },
          preferredCollaboratorName: "Lucas",
          activePackagesOrTags: ["clube-vip"],
          todayAppointments: [
            {
              appointmentId: "appt-today",
              serviceName: "Corte",
              collaboratorName: "Lucas",
              localDate: "2026-11-25",
              localTime: "18:00",
              startsAt: "2026-11-25T21:00:00.000Z",
              status: "CONFIRMED",
            },
          ],
        },
      },
      client: { id: "cli-1", name: "João Silva", phone: "+5511999990001" },
      history: [],
      latestClientMessage: "Estou atrasado 5 minutos",
      now: new Date("2026-11-25T20:50:00.000Z"),
      tools: {} as AiBookingToolExecutor,
    });

    expect(prompt).toContain("Av. Paulista, 1000");
    expect(prompt).toContain("https://maps.app.goo.gl/prime");
    expect(prompt).toContain("Tolerância máxima de 10 minutos.");
    expect(prompt).toContain("Profissional preferido: Lucas");
    expect(prompt).toContain("Agendamentos de hoje: 18:00 (Corte com Lucas");
    expect(prompt).toContain("request_human_handoff");
    expect(prompt).toContain("ESCOPO ESTRITO");
    expect(prompt).not.toContain("totalSpentCents");
  });

  it("enforces 10-message sliding window, maxOutputTokens=250, token usage and handoff tool", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      functionCall: {
                        name: "request_human_handoff",
                        args: { reason: "Cliente quer falar com o barbeiro" },
                      },
                    },
                  ],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 25 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Claro! Já chamei um atendente para você." }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 18 },
          }),
          { status: 200 },
        ),
      );

    const adapter = new GeminiBookingAgentAdapter("fake-key", "gemini-3.5-flash-lite");
    const history = Array.from({ length: 15 }, (_, idx) => ({
      direction: (idx % 2 === 0 ? "INBOUND" : "OUTBOUND") as "INBOUND" | "OUTBOUND",
      senderType: (idx % 2 === 0 ? "CLIENT" : "AI_AGENT") as "CLIENT" | "AI_AGENT",
      content: `Mensagem ${idx + 1}`,
      sentAt: new Date(2026, 10, 25, 10, idx).toISOString(),
    }));

    const output = await adapter.generateReply({
      company: {
        companyId: TENANT_A,
        companyName: "Barbearia Prime",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: null,
        services: [],
        collaborators: [],
      },
      client: { id: "cli-1", name: "João", phone: "+5511999990001" },
      history,
      latestClientMessage: "Quero falar com um atendente",
      now: new Date("2026-11-25T15:00:00.000Z"),
      tools: {
        ...(await createContextProvider().buildContextAndTools({
          companyId: TENANT_A,
          aiSystemPrompt: null,
          clientName: "João",
          clientPhone: "+5511999990001",
        }))!.tools,
      },
    });

    const firstBody = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as {
      contents: unknown[];
      generationConfig: { maxOutputTokens: number };
    };
    // 10 mensagens do histórico + 1 latestClientMessage = 11 itens
    expect(firstBody.contents).toHaveLength(11);
    expect(firstBody.generationConfig.maxOutputTokens).toBe(250);
    expect(output.handoffRequested?.reason).toContain("barbeiro");
    expect(output.usage).toEqual({
      model: "gemini-3.5-flash-lite",
      promptTokens: 270,
      completionTokens: 43,
    });
  });
});

describe("Stage 2 — Blocks 2 & 3: Governance, Anti-Spam, Quota, Debounce (4s) & Typing Delay (5s)", () => {
  it("groups fragmented messages with 4s debounce and sends composing -> 5s delay -> text -> paused", async () => {
    vi.useFakeTimers();
    const { gateway, events } = createFakeGateway();
    const orchestrator = new WhatsAppAiTurnOrchestrator(gateway, {
      defaultDebounceMs: 4_000,
      defaultTypingDelayMs: 5_000,
    });

    const flushed: string[] = [];
    orchestrator.scheduleTurn({
      tenantId: TENANT_A,
      conversationId: "conv-1",
      message: "oi",
      onFlush: async (merged) => {
        flushed.push(merged);
        await orchestrator.sendHumanizedReply({
          tenantId: TENANT_A,
          to: "+5511999990001",
          text: "Olá! Temos horário hoje sim.",
        });
      },
    });

    await vi.advanceTimersByTimeAsync(2_000);
    orchestrator.scheduleTurn({
      tenantId: TENANT_A,
      conversationId: "conv-1",
      message: "tem horário hoje?",
      onFlush: async (merged) => {
        flushed.push(merged);
        await orchestrator.sendHumanizedReply({
          tenantId: TENANT_A,
          to: "+5511999990001",
          text: "Olá! Temos horário hoje sim.",
        });
      },
    });

    // Ainda dentro da janela de 4s após a segunda mensagem
    await vi.advanceTimersByTimeAsync(3_500);
    expect(flushed).toHaveLength(0);

    // Completa os 4s de debounce -> envia composing, mas ainda aguarda 5s para o texto
    await vi.advanceTimersByTimeAsync(600);
    expect(flushed).toEqual(["oi\ntem horário hoje?"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "presence",
      payload: { tenantId: TENANT_A, to: "+5511999990001", presence: "composing" },
    });

    // Completa os 5s de digitação -> envia texto e presença paused
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events).toHaveLength(3);
    expect(events[1]?.type).toBe("text");
    expect(events[2]).toEqual({
      type: "presence",
      payload: { tenantId: TENANT_A, to: "+5511999990001", presence: "paused" },
    });

    orchestrator.dispose();
  });

  it("enforces anti-spam (>15 msgs/h pauses AI 2h with fixed reply), quota 100% block and pause/resume isolation", async () => {
    const conversationsRepo = new InMemoryConversationsRepo();
    const messagesRepo = new InMemoryMessagesRepo();
    const usageRepo = new InMemoryUsageRepo();
    const quotaGuard = new PlanQuotaGuardUseCase(usageRepo);
    const { gateway } = createFakeGateway();
    const insights: CreateProactiveInsightInput[] = [];
    const insightsWriter: ProactiveInsightsWriterPort = {
      createInsight: async (input) => {
        insights.push(input);
        return { id: `ins-${insights.length}` };
      },
    };

    const aiAgent: AiBookingAgentPort = {
      generateReply: vi.fn(
        async (_input: AiBookingAgentInput): Promise<AiBookingAgentOutput> => ({
          replyText: "Resposta da IA",
          provider: "GEMINI",
          actions: [],
          converted: false,
          usage: { model: "gemini-3.5-flash-lite", promptTokens: 80, completionTokens: 20 },
        }),
      ),
    };

    const useCase = new ProcessInboundWhatsAppMessageUseCase(
      createClientsRepo(),
      createConnectionsRepo(),
      conversationsRepo,
      messagesRepo,
      aiAgent,
      createContextProvider(),
      { send: vi.fn() },
      undefined,
      {
        planQuotaGuard: quotaGuard,
        whatsappGateway: gateway,
        proactiveInsightsWriter: insightsWriter,
      },
    );

    const baseTime = new Date("2026-11-25T15:00:00.000Z");

    // 15 mensagens dentro de 1h -> todas passam, reutilizando 1 única Sessão IA (janela 6h)
    for (let i = 1; i <= 15; i++) {
      const res = await useCase.execute({
        companyId: TENANT_A,
        phone: "+5511999990001",
        content: `Oi ${i}`,
        sentAt: new Date(baseTime.getTime() + i * 1_000),
        debounceMs: 0,
        typingDelayMs: 0,
      });
      expect(res.blockedReason).toBeUndefined();
    }

    expect(aiAgent.generateReply).toHaveBeenCalledTimes(15);
    const usageAfter15 = await quotaGuard.getUsageSummary(TENANT_A, baseTime);
    expect(usageAfter15.aiSessions.used).toBe(1);

    // 16ª mensagem dentro da mesma hora -> anti-spam dispara sem chamar Gemini
    const spamRes = await useCase.execute({
      companyId: TENANT_A,
      phone: "+5511999990001",
      content: "Oi 16",
      sentAt: new Date(baseTime.getTime() + 20_000),
      debounceMs: 0,
      typingDelayMs: 0,
    });
    expect(spamRes.blockedReason).toBe("ANTI_SPAM");
    expect(spamRes.outboundMessage?.content).toBe(ANTI_SPAM_FIXED_REPLY);
    expect(aiAgent.generateReply).toHaveBeenCalledTimes(15);
    expect(spamRes.conversation.aiPausedUntil).not.toBeNull();

    // 17ª mensagem enquanto aiPausedUntil está no futuro -> bloqueada por AI_PAUSED
    const pausedRes = await useCase.execute({
      companyId: TENANT_A,
      phone: "+5511999990001",
      content: "Tem alguém aí?",
      sentAt: new Date(baseTime.getTime() + 60_000),
      debounceMs: 0,
      typingDelayMs: 0,
    });
    expect(pausedRes.blockedReason).toBe("AI_PAUSED");
    expect(pausedRes.outboundMessage).toBeNull();

    // Pause/Resume isolation: Tenant B cannot resume Tenant A's conversation
    const pauseManager = new ManageWhatsAppConversationAiPauseUseCase(
      conversationsRepo,
      useCase.getTurnOrchestrator(),
    );
    await expect(
      pauseManager.resumeAi({
        companyId: TENANT_B,
        conversationId: spamRes.conversation.id,
      }),
    ).rejects.toThrow();

    const resumed = await pauseManager.resumeAi({
      companyId: TENANT_A,
      conversationId: spamRes.conversation.id,
    });
    expect(resumed.aiPausedUntil).toBeNull();
    expect(resumed.assignedMode).toBe("AI_AUTOPILOT");

    // Quota 100% atingida em Tenant B -> bloqueia Gemini e gera alerta interno
    usageRepo.plans.set(TENANT_B, "TRIAL"); // 50 sessions limit
    usageRepo.metrics.set(`${TENANT_B}:2026-11`, {
      tenantId: TENANT_B,
      periodMonth: "2026-11",
      aiSessionsCount: 50,
      outboundMessagesCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      updatedAt: baseTime,
    });

    const quotaBlocked = await useCase.execute({
      companyId: TENANT_B,
      phone: "+5511988887777",
      content: "Quero agendar",
      sentAt: baseTime,
      debounceMs: 0,
      typingDelayMs: 0,
    });
    expect(quotaBlocked.blockedReason).toBe("QUOTA_EXCEEDED");
    expect(quotaBlocked.outboundMessage).toBeNull();
    expect(insights.some((i) => i.tenantId === TENANT_B && i.type === "AI_QUOTA_REACHED")).toBe(true);
  });
});

describe("Stage 2 — Block 4: Idempotent Appointment Reminders (24h & 2h)", () => {
  it("dispatches reminders once, respects outbound quota and logs outbound history", async () => {
    const conversationsRepo = new InMemoryConversationsRepo();
    const messagesRepo = new InMemoryMessagesRepo();
    const usageRepo = new InMemoryUsageRepo();
    const quotaGuard = new PlanQuotaGuardUseCase(usageRepo);
    const { gateway } = createFakeGateway();

    const sentFlags = new Set<string>();
    const pendingItems: PendingReminderAppointment[] = [
      {
        appointmentId: "appt-24h",
        companyId: TENANT_A,
        companyName: "Barbearia Prime",
        companyTimezone: "America/Sao_Paulo",
        clientName: "Carlos",
        clientPhone: "+5511999990002",
        serviceName: "Corte",
        collaboratorName: "Lucas",
        startsAt: new Date("2026-11-26T15:00:00.000Z"),
      },
    ];

    const remindersRepo: AppointmentRemindersRepository = {
      findPendingReminders: async ({ windowType }) =>
        windowType === "24H"
          ? pendingItems.filter((a) => !sentFlags.has(`${a.appointmentId}:24H`))
          : [],
      markReminderSent: async ({ appointmentId, windowType }) => {
        const key = `${appointmentId}:${windowType}`;
        if (sentFlags.has(key)) return false;
        sentFlags.add(key);
        return true;
      },
    };

    const remindersUseCase = new ProcessAppointmentRemindersUseCase(
      remindersRepo,
      conversationsRepo,
      messagesRepo,
      gateway,
      quotaGuard,
    );

    const now = new Date("2026-11-25T15:00:00.000Z");
    const firstRun = await remindersUseCase.execute({ now });
    expect(firstRun.sentCount).toBe(1);
    expect(messagesRepo.messages).toHaveLength(1);
    expect(messagesRepo.messages[0]?.content).toContain("Barbearia Prime");

    const usage = await quotaGuard.getUsageSummary(TENANT_A, now);
    expect(usage.outboundMessages.used).toBe(1);

    // Segunda execução idempotente não envia duplicado
    const secondRun = await remindersUseCase.execute({ now });
    expect(secondRun.sentCount).toBe(0);
    expect(messagesRepo.messages).toHaveLength(1);
  });
});

describe("Stage 2 — Block 5: Post-Visit NPS (1-5) Routing", () => {
  it("routes score 5 to Google Maps link, score 4 to positive thanks without link, and score 1-3 to empathy + 2h pause + urgent insight", async () => {
    const conversationsRepo = new InMemoryConversationsRepo();
    const messagesRepo = new InMemoryMessagesRepo();
    const usageRepo = new InMemoryUsageRepo();
    const quotaGuard = new PlanQuotaGuardUseCase(usageRepo);
    const { gateway } = createFakeGateway();
    const insights: CreateProactiveInsightInput[] = [];
    const insightsWriter: ProactiveInsightsWriterPort = {
      createInsight: async (input) => {
        insights.push(input);
        return { id: `ins-${insights.length}` };
      },
    };

    const savedReviews: Array<{ companyId: string; rating: number; comment: string | null }> = [];
    const pendingByPhone = new Map<string, PendingNpsAppointment>();

    const makePending = (id: string, phone: string): PendingNpsAppointment => ({
      appointmentId: id,
      companyId: TENANT_A,
      companyName: "Barbearia Prime",
      googleMapsUrl: "https://maps.app.goo.gl/prime",
      collaboratorId: "collab-1",
      collaboratorName: "Lucas",
      serviceName: "Corte",
      clientName: "Pedro",
      clientPhone: phone,
      npsSentAt: new Date("2026-11-25T14:00:00.000Z"),
    });

    const npsRepo: PostVisitNpsRepository = {
      findCompletedEligibleForNps: async (): Promise<EligibleNpsAppointment[]> => [],
      markNpsSent: async () => true,
      findPendingNpsForPhone: async ({ companyId, phone }) => {
        const found = pendingByPhone.get(`${companyId}:${phone}`) ?? null;
        return found;
      },
      recordNpsResponse: async (params) => {
        savedReviews.push({
          companyId: params.companyId,
          rating: params.rating,
          comment: params.comment,
        });
        return true;
      },
    };

    const npsUseCase = new ProcessPostVisitNpsUseCase(
      npsRepo,
      conversationsRepo,
      messagesRepo,
      gateway,
      quotaGuard,
      insightsWriter,
    );

    const now = new Date("2026-11-25T15:00:00.000Z");

    // 1) Nota 5 -> salva review + envia link do Google Maps
    const phone5 = "+5511999990005";
    pendingByPhone.set(`${TENANT_A}:${phone5}`, makePending("appt-5", phone5));
    const conv5 = await conversationsRepo.upsertInbound({
      companyId: TENANT_A,
      phone: phone5,
      clientId: null,
      contactName: "Pedro",
      sentAt: now,
      incrementUnread: true,
    });
    const res5 = await npsUseCase.tryHandleInboundReply({
      companyId: TENANT_A,
      conversation: conv5,
      phone: phone5,
      content: "5",
      now,
    });
    expect(res5.handled).toBe(true);
    expect(res5.outboundMessage?.content).toContain("https://maps.app.goo.gl/prime");
    expect(savedReviews[0]).toEqual({ companyId: TENANT_A, rating: 5, comment: null });

    // 2) Nota 4 -> salva review + agradece SEM link externo
    const phone4 = "+5511999990004";
    pendingByPhone.set(`${TENANT_A}:${phone4}`, makePending("appt-4", phone4));
    const conv4 = await conversationsRepo.upsertInbound({
      companyId: TENANT_A,
      phone: phone4,
      clientId: null,
      contactName: "Pedro",
      sentAt: now,
      incrementUnread: true,
    });
    const res4 = await npsUseCase.tryHandleInboundReply({
      companyId: TENANT_A,
      conversation: conv4,
      phone: phone4,
      content: "4",
      now,
    });
    expect(res4.handled).toBe(true);
    expect(res4.outboundMessage?.content).not.toContain("maps.app.goo.gl");
    expect(savedReviews[1]?.rating).toBe(4);

    // 3) Nota 2 -> salva review + acolhe SEM link + pausa IA 2h + alerta NEGATIVE_NPS_ALERT
    const phone2 = "+5511999990002";
    pendingByPhone.set(`${TENANT_A}:${phone2}`, makePending("appt-2", phone2));
    const conv2 = await conversationsRepo.upsertInbound({
      companyId: TENANT_A,
      phone: phone2,
      clientId: null,
      contactName: "Pedro",
      sentAt: now,
      incrementUnread: true,
    });
    const res2 = await npsUseCase.tryHandleInboundReply({
      companyId: TENANT_A,
      conversation: conv2,
      phone: phone2,
      content: "2 - atrasou muito",
      now,
    });
    expect(res2.handled).toBe(true);
    expect(res2.outboundMessage?.content).not.toContain("maps.app.goo.gl");
    expect(res2.conversation?.aiPausedUntil?.getTime()).toBe(
      now.getTime() + 2 * 60 * 60 * 1000,
    );
    expect(savedReviews[2]).toEqual({
      companyId: TENANT_A,
      rating: 2,
      comment: "atrasou muito",
    });
    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      tenantId: TENANT_A,
      module: "CLIENTS",
      type: "NEGATIVE_NPS_ALERT",
    });
  });
});
