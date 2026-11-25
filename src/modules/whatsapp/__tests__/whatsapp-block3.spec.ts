import { describe, expect, it, vi } from "vitest";
import type { BusinessMetricsSnapshot } from "../application/ports/business-metrics-provider.port.js";
import { AnalyzeWhatsAppConversationUseCase } from "../application/use-cases/analyze-whatsapp-conversation.use-case.js";
import { AskBusinessCopilotUseCase } from "../application/use-cases/ask-business-copilot.use-case.js";
import { GetWhatsAppIntelligenceSummaryUseCase } from "../application/use-cases/get-whatsapp-intelligence-summary.use-case.js";
import type { ConversationalDispatchPort } from "../application/use-cases/process-inbound-whatsapp-message.use-case.js";
import { SendWhatsAppFollowupUseCase } from "../application/use-cases/send-whatsapp-followup.use-case.js";
import { AiConversationInsight } from "../domain/entities/ai-conversation-insight.entity.js";
import {
  WhatsAppConversation,
  type WhatsAppAssignedMode,
  type WhatsAppConversationStatus,
} from "../domain/entities/whatsapp-conversation.entity.js";
import { WhatsAppMessage } from "../domain/entities/whatsapp-message.entity.js";
import type { AiConversationInsightsRepository } from "../domain/repositories/ai-conversation-insights.repository.js";
import type {
  WhatsAppConversationListItem,
  WhatsAppConversationsRepository,
} from "../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../domain/repositories/whatsapp-messages.repository.js";
import {
  buildLocalBusinessCopilotReply,
  ResilientBusinessCopilotAdapter,
} from "../infra/ai/business-copilot.adapter.js";
import {
  analyzeConversationHeuristically,
  ResilientConversationAnalyzerAdapter,
} from "../infra/ai/conversation-analyzer.adapter.js";
import { createAiBookingAgentAdapter } from "../infra/ai/create-ai-booking-agent.js";

function createInMemoryStores() {
  const conversations: WhatsAppConversation[] = [];
  const messages: WhatsAppMessage[] = [];
  const insights = new Map<string, AiConversationInsight>();

  const conversationsRepo: WhatsAppConversationsRepository = {
    async findById(companyId, conversationId) {
      return (
        conversations.find(
          (c) => c.companyId === companyId && c.id === conversationId,
        ) ?? null
      );
    },
    async findByCompanyAndPhone(companyId, phone) {
      return (
        conversations.find(
          (c) => c.companyId === companyId && c.phone === phone,
        ) ?? null
      );
    },
    async upsertInbound() {
      throw new Error("not used");
    },
    async upsertOutbound() {
      throw new Error("not used");
    },
    async listByCompany(companyId): Promise<WhatsAppConversationListItem[]> {
      return conversations
        .filter((c) => c.companyId === companyId)
        .map((c) => {
          const lastMsg = messages
            .filter((m) => m.conversationId === c.id)
            .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
          return {
            conversation: c,
            lastMessagePreview: lastMsg?.content ?? null,
          };
        });
    },
    async resetUnreadCount() {},
    async updateAssignedMode(
      companyId,
      conversationId,
      assignedMode: WhatsAppAssignedMode,
    ) {
      const idx = conversations.findIndex(
        (c) => c.companyId === companyId && c.id === conversationId,
      );
      if (idx < 0) return null;
      const current = conversations[idx]!.toPersistence();
      const updated = WhatsAppConversation.restore({
        ...current,
        assignedMode,
        updatedAt: new Date(),
      });
      conversations[idx] = updated;
      return updated;
    },
    async updateStatus(
      companyId,
      conversationId,
      status: WhatsAppConversationStatus,
    ) {
      const idx = conversations.findIndex(
        (c) => c.companyId === companyId && c.id === conversationId,
      );
      if (idx < 0) return null;
      const current = conversations[idx]!.toPersistence();
      const updated = WhatsAppConversation.restore({
        ...current,
        status,
        updatedAt: new Date(),
      });
      conversations[idx] = updated;
      return updated;
    },
    async touchAfterOutbound(input) {
      const idx = conversations.findIndex(
        (c) =>
          c.companyId === input.companyId && c.id === input.conversationId,
      );
      if (idx < 0) return null;
      const current = conversations[idx]!.toPersistence();
      const updated = WhatsAppConversation.restore({
        ...current,
        lastMessageAt: input.sentAt,
        assignedMode: input.assignedMode ?? current.assignedMode,
        status: input.status ?? current.status,
        updatedAt: new Date(),
      });
      conversations[idx] = updated;
      return updated;
    },
  };

  const messagesRepo: WhatsAppMessagesRepository = {
    async findByExternalMessageId() {
      return null;
    },
    async createIdempotent(message) {
      messages.push(message);
      return { message, created: true };
    },
    async listByConversation(companyId, conversationId) {
      return messages.filter(
        (m) => m.companyId === companyId && m.conversationId === conversationId,
      );
    },
    async listRecentByConversation(companyId, conversationId, limit = 20) {
      return messages
        .filter(
          (m) =>
            m.companyId === companyId && m.conversationId === conversationId,
        )
        .slice(-limit);
    },
  };

  const insightsRepo: AiConversationInsightsRepository = {
    async findByConversationId(companyId, conversationId) {
      const item = insights.get(conversationId);
      return item && item.companyId === companyId ? item : null;
    },
    async listByCompany(companyId) {
      return Array.from(insights.values()).filter(
        (i) => i.companyId === companyId,
      );
    },
    async upsert(insight) {
      insights.set(insight.conversationId, insight);
      return insight;
    },
  };

  return {
    conversations,
    messages,
    insights,
    conversationsRepo,
    messagesRepo,
    insightsRepo,
  };
}

describe("Bloco 3 — WhatsApp Intelligence & Copiloto IA", () => {
  const companyId = "11111111-1111-4111-8111-111111111111";

  it("detecta objeção de preço na análise heurística e gera follow-up comercial", () => {
    const output = analyzeConversationHeuristically({
      companyId,
      conversationId: "conv-1",
      contactName: "Lucas Silva",
      phone: "+5511999990001",
      currentStatus: "OPEN",
      messages: [
        {
          direction: "INBOUND",
          senderType: "CLIENT",
          content: "Quanto custa o corte e barba? Achei um pouco caro, tem desconto?",
          sentAt: new Date().toISOString(),
        },
      ],
    });

    expect(output.detectedObjection).toBe("PRICE");
    expect(output.appointmentConfirmed).toBe(false);
    expect(output.suggestedFollowupReply).toContain("Lucas");
    expect(output.provider).toBe("HEURISTIC");
  });

  it("converte automaticamente conversa para CONVERTED e HOT (>=90) ao confirmar agendamento", async () => {
    const stores = createInMemoryStores();
    const conv = WhatsAppConversation.create({
      companyId,
      phone: "+5511988887777",
      contactName: "Rafael Costa",
      status: "OPEN",
    });
    stores.conversations.push(conv);
    stores.messages.push(
      WhatsAppMessage.create({
        companyId,
        conversationId: conv.id,
        direction: "INBOUND",
        senderType: "CLIENT",
        content: "Quero agendar corte amanhã às 15h",
      }),
      WhatsAppMessage.create({
        companyId,
        conversationId: conv.id,
        direction: "OUTBOUND",
        senderType: "AI_AGENT",
        content: "Perfeito, Rafael! Agendamento confirmado para amanhã às 15h.",
      }),
    );

    const useCase = new AnalyzeWhatsAppConversationUseCase(
      stores.conversationsRepo,
      stores.messagesRepo,
      stores.insightsRepo,
      {
        async analyze(input) {
          return analyzeConversationHeuristically(input);
        },
      },
    );

    const dto = await useCase.execute({
      companyId,
      conversationId: conv.id,
    });

    expect(dto).not.toBeNull();
    expect(dto!.leadTemperature).toBe("HOT");
    expect(dto!.leadScore).toBeGreaterThanOrEqual(90);
    expect(dto!.detectedObjection).toBe("NONE");

    const updatedConv = await stores.conversationsRepo.findById(
      companyId,
      conv.id,
    );
    expect(updatedConv?.status).toBe("CONVERTED");
  });

  it("calcula KPIs, taxa de conversão, objeções e conversas paradas (>24h) no resumo", async () => {
    const stores = createInMemoryStores();
    const now = new Date("2026-11-24T18:00:00.000Z");
    const thirtyHoursAgo = new Date(now.getTime() - 30 * 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const convertedConv = WhatsAppConversation.create({
      companyId,
      phone: "+5511977771111",
      contactName: "Pedro",
      status: "CONVERTED",
      now: twoHoursAgo,
    });
    const stalledPriceConv = WhatsAppConversation.create({
      companyId,
      phone: "+5511977772222",
      contactName: "João",
      status: "WAITING_CLIENT",
      now: thirtyHoursAgo,
    });
    const activeTimingConv = WhatsAppConversation.create({
      companyId,
      phone: "+5511977773333",
      contactName: "Carlos",
      status: "OPEN",
      now: twoHoursAgo,
    });

    stores.conversations.push(convertedConv, stalledPriceConv, activeTimingConv);

    await stores.insightsRepo.upsert(
      AiConversationInsight.create({
        companyId,
        conversationId: stalledPriceConv.id,
        leadTemperature: "WARM",
        leadScore: 65,
        summary: "Perguntou preço do pacote",
        detectedObjection: "PRICE",
        recommendedNextAction: "Oferecer combo",
        suggestedFollowupReply: "Olá João, temos uma condição especial!",
      }),
    );
    await stores.insightsRepo.upsert(
      AiConversationInsight.create({
        companyId,
        conversationId: activeTimingConv.id,
        leadTemperature: "COLD",
        leadScore: 35,
        summary: "Vai ver semana que vem",
        detectedObjection: "TIMING",
        recommendedNextAction: "Retomar sexta-feira",
        suggestedFollowupReply: "Olá Carlos, já sabe qual dia fica melhor?",
      }),
    );

    const summaryUseCase = new GetWhatsAppIntelligenceSummaryUseCase(
      stores.conversationsRepo,
      stores.insightsRepo,
    );

    const result = await summaryUseCase.execute({ companyId, days: 30, now });

    expect(result.kpis.totalConversations).toBe(3);
    expect(result.kpis.convertedAppointments).toBe(1);
    expect(result.kpis.conversionRate).toBe(33.3);
    expect(result.kpis.stalledConversationsCount).toBe(1);
    expect(result.objectionsBreakdown.find((o) => o.objection === "PRICE")?.count).toBe(1);
    expect(result.objectionsBreakdown.find((o) => o.objection === "TIMING")?.count).toBe(1);
    expect(result.conversations[0]?.conversationId).toBe(stalledPriceConv.id);
    expect(result.conversations[0]?.isStalled).toBe(true);
  });

  it("envia follow-up em 1 clique usando a mensagem sugerida do insight e salva metadata FOLLOWUP", async () => {
    const stores = createInMemoryStores();
    const conv = WhatsAppConversation.create({
      companyId,
      phone: "+5511966665555",
      contactName: "Marcos",
      status: "OPEN",
    });
    stores.conversations.push(conv);
    await stores.insightsRepo.upsert(
      AiConversationInsight.create({
        companyId,
        conversationId: conv.id,
        leadTemperature: "WARM",
        leadScore: 68,
        summary: "Interessado em barba",
        detectedObjection: "SCHEDULE_FULL",
        recommendedNextAction: "Oferecer encaixe",
        suggestedFollowupReply: "Olá Marcos, abriu uma vaga hoje às 17h!",
      }),
    );

    const sendMock = vi.fn<ConversationalDispatchPort["send"]>().mockResolvedValue({
      purpose: "CONVERSATIONAL_REPLY",
      provider: "MOCK_READY",
      referenceId: "ref-followup-1",
    });

    const followupUseCase = new SendWhatsAppFollowupUseCase(
      stores.conversationsRepo,
      stores.messagesRepo,
      stores.insightsRepo,
      { send: sendMock },
    );

    const result = await followupUseCase.execute({
      companyId,
      conversationId: conv.id,
    });

    expect(sendMock).toHaveBeenCalledWith({
      purpose: "CONVERSATIONAL_REPLY",
      companyId,
      phone: conv.phone,
      text: "Olá Marcos, abriu uma vaga hoje às 17h!",
    });
    expect(result.message.content).toBe("Olá Marcos, abriu uma vaga hoje às 17h!");
    expect(result.message.metadata.kind).toBe("FOLLOWUP");
    expect(result.conversation.assignedMode).toBe("HUMAN");
  });

  it("responde no Copiloto IA com métricas reais da empresa usando o motor analítico local", async () => {
    const fakeMetrics: BusinessMetricsSnapshot = {
      companyName: "Barbearia Prime",
      currency: "BRL",
      referenceDate: "2026-11-24",
      revenue: {
        todayCents: 125000,
        monthCents: 1850000,
        openOrdersCount: 3,
        openOrdersTotalCents: 24000,
      },
      appointments: {
        todayTotal: 14,
        todayConfirmed: 8,
        todayCompleted: 6,
        monthTotal: 210,
        monthCompleted: 180,
        monthCanceled: 20,
        monthNoShow: 10,
      },
      commissions: {
        pendingCount: 5,
        pendingTotalCents: 45000,
      },
      clients: {
        totalClients: 320,
        inactive30dCount: 42,
      },
      whatsapp: {
        totalConversations30d: 80,
        convertedConversations30d: 28,
        conversionRatePercent: 35,
        stalledConversations24h: 6,
        hotLeadsCount: 12,
        topObjection: "PRICE",
      },
    };

    const copilotUseCase = new AskBusinessCopilotUseCase(
      {
        async getSnapshot() {
          return fakeMetrics;
        },
      },
      {
        async answer(input) {
          return buildLocalBusinessCopilotReply(input);
        },
      },
    );

    const result = await copilotUseCase.execute({
      companyId,
      message: "Como está meu faturamento e a conversão do WhatsApp?",
    });

    expect(result.provider).toBe("LOCAL_ANALYTICS");
    expect(result.reply).toContain("1.250,00");
    expect(result.reply).toContain("35%");
    expect(result.reply).toContain("6 conversas paradas");
    expect(result.metricsSummary.openOrdersCount).toBe(3);
  });

  it("lê GEMINI_API_KEY via env validado nos três adaptadores de IA usando header x-goog-api-key", async () => {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    const prevGeminiModel = process.env.GEMINI_MODEL;

    process.env.GEMINI_API_KEY = "test-gemini-key-123";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_MODEL;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url, init) => {
        const headers = init?.headers as Record<string, string> | undefined;
        expect(String(url)).toContain(
          "generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
        );
        expect(String(url)).not.toContain("?key=");
        expect(headers?.["x-goog-api-key"]).toBe("test-gemini-key-123");

        const bodyText = String(init?.body ?? "");
        if (bodyText.includes("listar_servicos_e_profissionais")) {
          const parsedBody = JSON.parse(bodyText) as {
            tools?: Array<{
              functionDeclarations?: Array<{
                name: string;
                parameters?: unknown;
              }>;
            }>;
          };
          const listTool = parsedBody.tools?.[0]?.functionDeclarations?.find(
            (t) => t.name === "listar_servicos_e_profissionais",
          );
          expect(listTool).toBeDefined();
          expect(listTool?.parameters).toBeUndefined();
        }
        const responseText = bodyText.includes("leadTemperature")
          ? JSON.stringify({
              leadTemperature: "HOT",
              leadScore: 88,
              summary: "Lead quente analisado pelo Gemini.",
              detectedObjection: "NONE",
              recommendedNextAction: "Confirmar horário",
              suggestedFollowupReply: "Olá! Vamos confirmar às 15h?",
              appointmentConfirmed: false,
            })
          : "Resposta gerada pelo Gemini com sucesso.";

        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: responseText }] } },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    try {
      const bookingAgent = createAiBookingAgentAdapter();
      const bookingReply = await bookingAgent.generateReply({
        company: {
          companyId,
          companyName: "Barbearia Teste",
          timezone: "America/Sao_Paulo",
          aiSystemPrompt: null,
          services: [],
          collaborators: [],
        },
        client: { id: null, name: "João", phone: "+5511999990001" },
        history: [],
        latestClientMessage: "Oi, quero agendar",
        now: new Date(),
        tools: {
          listServicesAndProfessionals: async () => ({
            services: [],
            collaborators: [],
          }),
          checkAvailability: async () => ({
            date: "2026-11-24",
            timezone: "America/Sao_Paulo",
            serviceDurationMinutes: 30,
            slots: [],
          }),
          listCustomerUpcomingAppointments: async () => ({ appointments: [] }),
          createAppointment: async () => ({
            id: "appt-1",
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
            status: "CONFIRMED",
            serviceName: "Corte",
            collaboratorId: "collab-1",
          }),
          rescheduleAppointment: async () => ({
            id: "appt-1",
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
            status: "CONFIRMED",
            collaboratorId: "collab-1",
          }),
          cancelAppointment: async () => ({
            id: "appt-1",
            status: "CANCELED",
          }),
        },
      });
      expect(bookingReply.provider).toBe("GEMINI");

      const analyzer = new ResilientConversationAnalyzerAdapter();
      const analysis = await analyzer.analyze({
        companyId,
        conversationId: "conv-gemini",
        contactName: "João",
        phone: "+5511999990001",
        currentStatus: "OPEN",
        messages: [
          {
            direction: "INBOUND",
            senderType: "CLIENT",
            content: "Quero agendar corte hoje",
            sentAt: new Date().toISOString(),
          },
        ],
      });
      expect(analysis.provider).toBe("GEMINI");
      expect(analysis.leadScore).toBe(88);

      const copilot = new ResilientBusinessCopilotAdapter();
      const copilotAnswer = await copilot.answer({
        message: "Como está meu faturamento?",
        history: [],
        metrics: {
          companyName: "Barbearia Teste",
          currency: "BRL",
          referenceDate: "2026-11-24",
          revenue: {
            todayCents: 10000,
            monthCents: 50000,
            openOrdersCount: 1,
            openOrdersTotalCents: 5000,
          },
          appointments: {
            todayTotal: 2,
            todayConfirmed: 2,
            todayCompleted: 0,
            monthTotal: 10,
            monthCompleted: 8,
            monthCanceled: 1,
            monthNoShow: 1,
          },
          commissions: { pendingCount: 0, pendingTotalCents: 0 },
          clients: { totalClients: 20, inactive30dCount: 3 },
          whatsapp: {
            totalConversations30d: 10,
            convertedConversations30d: 4,
            conversionRatePercent: 40,
            stalledConversations24h: 1,
            hotLeadsCount: 3,
            topObjection: "NONE",
          },
        },
      });
      expect(copilotAnswer.provider).toBe("GEMINI");
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    } finally {
      fetchSpy.mockRestore();
      if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGeminiKey;
      if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAiKey;
      if (prevGeminiModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = prevGeminiModel;
    }
  });

  it("faz fallback automático de gemini-3.5-flash-lite para gemini-3.5-flash em HTTP 503/429 antes de cair em SIMULATED", async () => {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    const prevGeminiModel = process.env.GEMINI_MODEL;
    const prevFallbackModel = process.env.GEMINI_FALLBACK_MODEL;

    process.env.GEMINI_API_KEY = "test-gemini-key-fallback";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;

    const calledUrls: string[] = [];
    const calledBodies: Array<Record<string, unknown>> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (url, init) => {
        const urlStr = String(url);
        calledUrls.push(urlStr);
        if (typeof init?.body === "string") {
          calledBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        }

        if (urlStr.includes("models/gemini-3.5-flash-lite:generateContent")) {
          const status = calledUrls.length === 1 ? 503 : 429;
          return new Response(
            JSON.stringify({ error: { message: "Overloaded / rate limit" } }),
            { status, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        leadTemperature: "WARM",
                        leadScore: 70,
                        summary: "Analisado via fallback lite.",
                        detectedObjection: "NONE",
                        recommendedNextAction: "Oferecer horário",
                        suggestedFollowupReply: "Olá! Posso agendar?",
                        appointmentConfirmed: false,
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    try {
      const bookingAgent = createAiBookingAgentAdapter();
      const bookingReply = await bookingAgent.generateReply({
        company: {
          companyId,
          companyName: "Barbearia Fallback",
          timezone: "America/Sao_Paulo",
          aiSystemPrompt: null,
          services: [],
          collaborators: [],
        },
        client: { id: null, name: "Ana", phone: "+5511999990002" },
        history: [],
        latestClientMessage: "Oi!",
        now: new Date(),
        tools: {
          listServicesAndProfessionals: async () => ({
            services: [],
            collaborators: [],
          }),
          checkAvailability: async () => ({
            date: "2026-11-24",
            timezone: "America/Sao_Paulo",
            serviceDurationMinutes: 30,
            slots: [],
          }),
          listCustomerUpcomingAppointments: async () => ({ appointments: [] }),
          createAppointment: async () => ({
            id: "appt-1",
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
            status: "CONFIRMED",
            serviceName: "Corte",
            collaboratorId: "collab-1",
          }),
          rescheduleAppointment: async () => ({
            id: "appt-1",
            startsAt: new Date().toISOString(),
            endsAt: new Date().toISOString(),
            status: "CONFIRMED",
            collaboratorId: "collab-1",
          }),
          cancelAppointment: async () => ({
            id: "appt-1",
            status: "CANCELED",
          }),
        },
      });
      expect(bookingReply.provider).toBe("GEMINI");

      const analyzer = new ResilientConversationAnalyzerAdapter();
      const analysis = await analyzer.analyze({
        companyId,
        conversationId: "conv-503",
        contactName: "Ana",
        phone: "+5511999990002",
        currentStatus: "OPEN",
        messages: [
          {
            direction: "INBOUND",
            senderType: "CLIENT",
            content: "Quero horário amanhã",
            sentAt: new Date().toISOString(),
          },
        ],
      });
      expect(analysis.provider).toBe("GEMINI");
      expect(analysis.leadScore).toBe(70);

      const copilot = new ResilientBusinessCopilotAdapter();
      const copilotAnswer = await copilot.answer({
        message: "Resumo do dia",
        history: [],
        metrics: {
          companyName: "Barbearia Fallback",
          currency: "BRL",
          referenceDate: "2026-11-24",
          revenue: {
            todayCents: 0,
            monthCents: 0,
            openOrdersCount: 0,
            openOrdersTotalCents: 0,
          },
          appointments: {
            todayTotal: 0,
            todayConfirmed: 0,
            todayCompleted: 0,
            monthTotal: 0,
            monthCompleted: 0,
            monthCanceled: 0,
            monthNoShow: 0,
          },
          commissions: { pendingCount: 0, pendingTotalCents: 0 },
          clients: { totalClients: 0, inactive30dCount: 0 },
          whatsapp: {
            totalConversations30d: 0,
            convertedConversations30d: 0,
            conversionRatePercent: 0,
            stalledConversations24h: 0,
            hotLeadsCount: 0,
            topObjection: "NONE",
          },
        },
      });
      expect(copilotAnswer.provider).toBe("GEMINI");

      expect(calledUrls).toHaveLength(6);
      expect(calledUrls[0]).toContain("models/gemini-3.5-flash-lite:generateContent");
      expect(calledUrls[1]).toContain("models/gemini-3.5-flash:generateContent");
      expect(calledUrls[2]).toContain("models/gemini-3.5-flash-lite:generateContent");
      expect(calledUrls[3]).toContain("models/gemini-3.5-flash:generateContent");
      expect(calledUrls[4]).toContain("models/gemini-3.5-flash-lite:generateContent");
      expect(calledUrls[5]).toContain("models/gemini-3.5-flash:generateContent");
      expect(calledBodies[0]?.generationConfig).toEqual({
        thinkingConfig: { thinkingLevel: "minimal" },
        temperature: 0.4,
        maxOutputTokens: 250,
      });
    } finally {
      fetchSpy.mockRestore();
      if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGeminiKey;
      if (prevOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevOpenAiKey;
      if (prevGeminiModel === undefined) delete process.env.GEMINI_MODEL;
      else process.env.GEMINI_MODEL = prevGeminiModel;
      if (prevFallbackModel === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
      else process.env.GEMINI_FALLBACK_MODEL = prevFallbackModel;
    }
  });
});
