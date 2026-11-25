import type {
  DetectedObjection,
  LeadTemperature,
} from "../../domain/entities/ai-conversation-insight.entity.js";
import type {
  WhatsAppAssignedMode,
  WhatsAppConversationStatus,
} from "../../domain/entities/whatsapp-conversation.entity.js";
import type { AiConversationInsightsRepository } from "../../domain/repositories/ai-conversation-insights.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";

export interface ObjectionBreakdownItem {
  objection: Exclude<DetectedObjection, "NONE">;
  count: number;
  percentage: number;
}

export interface IntelligenceConversationItem {
  conversationId: string;
  clientId: string | null;
  contactName: string | null;
  phone: string;
  status: WhatsAppConversationStatus;
  assignedMode: WhatsAppAssignedMode;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  isStalled: boolean;
  hoursSinceLastMessage: number;
  hasInsight: boolean;
  leadTemperature: LeadTemperature;
  leadScore: number;
  summary: string;
  detectedObjection: DetectedObjection;
  recommendedNextAction: string;
  suggestedFollowupReply: string;
  analyzedAt: string | null;
}

export interface WhatsAppIntelligenceSummaryOutput {
  periodDays: number;
  kpis: {
    totalConversations: number;
    opportunities: number;
    convertedAppointments: number;
    conversionRate: number;
    stalledConversationsCount: number;
    hotLeadsCount: number;
    warmLeadsCount: number;
    coldLeadsCount: number;
  };
  funnel: {
    started: number;
    opportunities: number;
    hotLeads: number;
    converted: number;
  };
  objectionsBreakdown: ObjectionBreakdownItem[];
  conversations: IntelligenceConversationItem[];
}

const TRACKED_OBJECTIONS: Array<Exclude<DetectedObjection, "NONE">> = [
  "PRICE",
  "SCHEDULE_FULL",
  "TIMING",
  "PAYMENT_METHOD",
  "OTHER",
];

// Consolida KPIs do funil de WhatsApp, objeções detectadas e lista priorizada de follow-ups por empresa.
export class GetWhatsAppIntelligenceSummaryUseCase {
  constructor(
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly insightsRepository: AiConversationInsightsRepository,
  ) {}

  async execute(input: {
    companyId: string;
    days?: number | undefined;
    now?: Date | undefined;
  }): Promise<WhatsAppIntelligenceSummaryOutput> {
    const periodDays = Math.min(Math.max(Math.round(input.days ?? 30), 1), 365);
    const now = input.now ?? new Date();
    const periodStart = new Date(
      now.getTime() - periodDays * 24 * 60 * 60 * 1000,
    );
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [conversationItems, insights] = await Promise.all([
      this.conversationsRepository.listByCompany(input.companyId, {
        limit: 200,
      }),
      this.insightsRepository.listByCompany(input.companyId),
    ]);

    const insightByConversationId = new Map(
      insights.map((insight) => [insight.conversationId, insight]),
    );

    const filteredConversations = conversationItems.filter(
      (item) => item.conversation.lastMessageAt >= periodStart,
    );

    let convertedAppointments = 0;
    let opportunities = 0;
    let stalledConversationsCount = 0;
    let hotLeadsCount = 0;
    let warmLeadsCount = 0;
    let coldLeadsCount = 0;

    const objectionCounts = new Map<Exclude<DetectedObjection, "NONE">, number>(
      TRACKED_OBJECTIONS.map((code) => [code, 0]),
    );

    const enriched: IntelligenceConversationItem[] = filteredConversations.map(
      ({ conversation, lastMessagePreview }) => {
        const insight = insightByConversationId.get(conversation.id);
        const isConverted = conversation.status === "CONVERTED";
        const isArchived = conversation.status === "ARCHIVED";

        if (isConverted) {
          convertedAppointments += 1;
        }
        if (!isArchived) {
          opportunities += 1;
        }

        const hoursSinceLastMessage = Math.max(
          0,
          Math.floor(
            (now.getTime() - conversation.lastMessageAt.getTime()) /
              (1000 * 60 * 60),
          ),
        );
        const isStalled =
          !isConverted &&
          !isArchived &&
          conversation.lastMessageAt < twentyFourHoursAgo;

        if (isStalled) {
          stalledConversationsCount += 1;
        }

        const leadTemperature: LeadTemperature = isConverted
          ? "HOT"
          : (insight?.leadTemperature ?? "WARM");
        const leadScore = isConverted
          ? Math.max(90, insight?.leadScore ?? 95)
          : (insight?.leadScore ?? 50);

        if (leadTemperature === "HOT") hotLeadsCount += 1;
        else if (leadTemperature === "COLD") coldLeadsCount += 1;
        else warmLeadsCount += 1;

        const detectedObjection: DetectedObjection = isConverted
          ? "NONE"
          : (insight?.detectedObjection ?? "NONE");

        if (detectedObjection !== "NONE") {
          objectionCounts.set(
            detectedObjection,
            (objectionCounts.get(detectedObjection) ?? 0) + 1,
          );
        }

        const greetingName = conversation.contactName?.trim().split(/\s+/)[0];
        const defaultReply = `Olá${greetingName ? `, ${greetingName}` : ""}! Tudo bem? Posso te ajudar a reservar um horário para o seu próximo atendimento?`;

        return {
          conversationId: conversation.id,
          clientId: conversation.clientId,
          contactName: conversation.contactName,
          phone: conversation.phone,
          status: conversation.status,
          assignedMode: conversation.assignedMode,
          unreadCount: conversation.unreadCount,
          lastMessageAt: conversation.lastMessageAt.toISOString(),
          lastMessagePreview,
          isStalled,
          hoursSinceLastMessage,
          hasInsight: Boolean(insight),
          leadTemperature,
          leadScore,
          summary:
            insight?.summary ??
            (isConverted
              ? "Conversa concluída com agendamento confirmado."
              : "Conversa ativa aguardando análise detalhada."),
          detectedObjection,
          recommendedNextAction:
            insight?.recommendedNextAction ??
            (isStalled
              ? "Enviar mensagem de follow-up para retomar o contato."
              : "Conduzir cliente para escolha de horário."),
          suggestedFollowupReply:
            insight?.suggestedFollowupReply ?? defaultReply,
          analyzedAt: insight ? insight.analyzedAt.toISOString() : null,
        };
      },
    );

    // Ordena priorizando conversas paradas/quentes não convertidas para facilitar ação comercial do dono
    enriched.sort((a, b) => {
      const priorityA =
        (a.status === "CONVERTED" ? 0 : 100) +
        (a.isStalled ? 40 : 0) +
        a.leadScore;
      const priorityB =
        (b.status === "CONVERTED" ? 0 : 100) +
        (b.isStalled ? 40 : 0) +
        b.leadScore;
      if (priorityB !== priorityA) {
        return priorityB - priorityA;
      }
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });

    const totalConversations = filteredConversations.length;
    const conversionRate =
      totalConversations > 0
        ? Math.round((convertedAppointments / totalConversations) * 1000) / 10
        : 0;

    const totalDetectedObjections = Array.from(
      objectionCounts.values(),
    ).reduce((acc, count) => acc + count, 0);

    const objectionsBreakdown: ObjectionBreakdownItem[] = TRACKED_OBJECTIONS.map(
      (objection) => {
        const count = objectionCounts.get(objection) ?? 0;
        const percentage =
          totalDetectedObjections > 0
            ? Math.round((count / totalDetectedObjections) * 1000) / 10
            : 0;
        return { objection, count, percentage };
      },
    ).sort((a, b) => b.count - a.count);

    return {
      periodDays,
      kpis: {
        totalConversations,
        opportunities,
        convertedAppointments,
        conversionRate,
        stalledConversationsCount,
        hotLeadsCount,
        warmLeadsCount,
        coldLeadsCount,
      },
      funnel: {
        started: totalConversations,
        opportunities,
        hotLeads: hotLeadsCount,
        converted: convertedAppointments,
      },
      objectionsBreakdown,
      conversations: enriched,
    };
  }
}
