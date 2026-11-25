import type {
  BusinessCopilotPort,
  CopilotHistoryMessage,
} from "../ports/business-copilot.port.js";
import type { BusinessMetricsProviderPort } from "../ports/business-metrics-provider.port.js";

export interface AskBusinessCopilotOutput {
  reply: string;
  provider: "OPENAI" | "GEMINI" | "LOCAL_ANALYTICS";
  suggestedFollowups: string[];
  metricsSummary: {
    companyName: string;
    referenceDate: string;
    revenueTodayCents: number;
    revenueMonthCents: number;
    openOrdersCount: number;
    appointmentsToday: number;
    pendingCommissionsCents: number;
    inactiveClients30d: number;
    whatsappConversionRatePercent: number;
    whatsappStalled24h: number;
  };
}

// Caso de uso do Copiloto IA de Gestão: coleta métricas reais da empresa e responde perguntas do proprietário.
export class AskBusinessCopilotUseCase {
  constructor(
    private readonly metricsProvider: BusinessMetricsProviderPort,
    private readonly copilotAdapter: BusinessCopilotPort,
  ) {}

  async execute(input: {
    companyId: string;
    message: string;
    history?: CopilotHistoryMessage[] | undefined;
  }): Promise<AskBusinessCopilotOutput> {
    const metrics = await this.metricsProvider.getSnapshot(input.companyId);
    const answer = await this.copilotAdapter.answer({
      message: input.message.trim(),
      history: input.history ?? [],
      metrics,
    });

    return {
      reply: answer.reply,
      provider: answer.provider,
      suggestedFollowups: answer.suggestedFollowups,
      metricsSummary: {
        companyName: metrics.companyName,
        referenceDate: metrics.referenceDate,
        revenueTodayCents: metrics.revenue.todayCents,
        revenueMonthCents: metrics.revenue.monthCents,
        openOrdersCount: metrics.revenue.openOrdersCount,
        appointmentsToday: metrics.appointments.todayTotal,
        pendingCommissionsCents: metrics.commissions.pendingTotalCents,
        inactiveClients30d: metrics.clients.inactive30dCount,
        whatsappConversionRatePercent: metrics.whatsapp.conversionRatePercent,
        whatsappStalled24h: metrics.whatsapp.stalledConversations24h,
      },
    };
  }
}
