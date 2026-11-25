import type {
  QuotaCheckResult,
  RecordAiUsageInput,
  RegisterAiSessionResult,
  TenantUsageMetricsRecord,
  UsageSummary,
} from "../../domain/entities/tenant-usage.types.js";
import type { TenantUsageRepository } from "../../domain/repositories/tenant-usage.repository.js";
import {
  AI_SESSION_WINDOW_MS,
  PlanLimitsResolver,
  computeQuotaPercentage,
  formatPeriodMonth,
} from "../../domain/services/plan-limits-resolver.js";

// Caso de uso central de governança de cotas: calcula consumo mensal por tenant,
// aplica a regra de janela de 6h por Sessão IA e bloqueia operações ao atingir 100% do limite.
export class PlanQuotaGuardUseCase {
  constructor(
    private readonly usageRepository: TenantUsageRepository,
    private readonly planLimitsResolver: PlanLimitsResolver = new PlanLimitsResolver(),
  ) {}

  public async getUsageSummary(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<UsageSummary> {
    const periodMonth = formatPeriodMonth(now);
    const [planTier, metrics] = await Promise.all([
      this.usageRepository.getTenantPlanTier(tenantId),
      this.usageRepository.getMonthlyUsage(tenantId, periodMonth),
    ]);

    const limits = this.planLimitsResolver.resolve(planTier);
    const aiUsed = metrics?.aiSessionsCount ?? 0;
    const outboundUsed = metrics?.outboundMessagesCount ?? 0;

    return {
      planName: limits.planName,
      periodMonth,
      aiSessions: {
        used: aiUsed,
        limit: limits.aiSessionsLimit,
        percentage: computeQuotaPercentage(aiUsed, limits.aiSessionsLimit),
      },
      outboundMessages: {
        used: outboundUsed,
        limit: limits.outboundMessagesLimit,
        percentage: computeQuotaPercentage(
          outboundUsed,
          limits.outboundMessagesLimit,
        ),
      },
      isBlocked:
        aiUsed >= limits.aiSessionsLimit ||
        outboundUsed >= limits.outboundMessagesLimit,
    };
  }

  public async checkCanUseAiSession(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<QuotaCheckResult> {
    const usage = await this.getUsageSummary(tenantId, now);
    if (usage.aiSessions.used >= usage.aiSessions.limit) {
      return {
        allowed: false,
        reason: `Limite mensal de sessões IA atingido (${usage.aiSessions.used}/${usage.aiSessions.limit}) para o plano ${usage.planName}.`,
        usage,
      };
    }

    return { allowed: true, usage };
  }

  public async checkCanSendOutbound(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<QuotaCheckResult> {
    const usage = await this.getUsageSummary(tenantId, now);
    if (usage.outboundMessages.used >= usage.outboundMessages.limit) {
      return {
        allowed: false,
        reason: `Limite mensal de disparos WhatsApp atingido (${usage.outboundMessages.used}/${usage.outboundMessages.limit}) para o plano ${usage.planName}.`,
        usage,
      };
    }

    return { allowed: true, usage };
  }

  // Regra de Sessão IA: mensagens na mesma conversa dentro de 6h reutilizam a sessão ativa
  // sem descontar nova cota; após 6h (ou na primeira interação), valida cota e incrementa +1.
  public async registerOrReuseAiSession(params: {
    tenantId: string;
    conversationId: string;
    now?: Date;
  }): Promise<RegisterAiSessionResult> {
    const now = params.now ?? new Date();
    const lastSessionAt =
      await this.usageRepository.getConversationLastAiSessionAt(
        params.tenantId,
        params.conversationId,
      );

    if (
      lastSessionAt !== null &&
      now.getTime() - lastSessionAt.getTime() < AI_SESSION_WINDOW_MS
    ) {
      const usage = await this.getUsageSummary(params.tenantId, now);
      return {
        allowed: true,
        isNewSession: false,
        usage,
      };
    }

    const check = await this.checkCanUseAiSession(params.tenantId, now);
    if (!check.allowed) {
      return {
        allowed: false,
        isNewSession: false,
        ...(check.reason !== undefined ? { reason: check.reason } : {}),
        usage: check.usage,
      };
    }

    const periodMonth = formatPeriodMonth(now);
    const updatedConversation =
      await this.usageRepository.updateConversationLastAiSessionAt(
        params.tenantId,
        params.conversationId,
        now,
      );

    // Só contabiliza a sessão se a conversa realmente pertencer ao tenant autenticado.
    if (!updatedConversation) {
      return {
        allowed: false,
        isNewSession: false,
        reason: "Conversa não encontrada para este tenant.",
        usage: check.usage,
      };
    }

    await this.usageRepository.incrementAiSessionCount(
      params.tenantId,
      periodMonth,
      now,
    );

    const updatedUsage = await this.getUsageSummary(params.tenantId, now);
    return {
      allowed: true,
      isNewSession: true,
      usage: updatedUsage,
    };
  }

  public async recordAiUsage(
    input: RecordAiUsageInput,
  ): Promise<TenantUsageMetricsRecord> {
    const now = input.now ?? new Date();
    const periodMonth = formatPeriodMonth(now);
    const promptTokens = Math.max(0, Math.trunc(input.promptTokens));
    const completionTokens = Math.max(0, Math.trunc(input.completionTokens));

    return this.usageRepository.incrementUsageAndLog({
      tenantId: input.tenantId,
      periodMonth,
      feature: input.feature,
      model: input.model.trim() || "unknown",
      promptTokens,
      completionTokens,
      aiSessionsDelta: input.incrementSession ? 1 : 0,
      outboundMessagesDelta: input.incrementOutbound ? 1 : 0,
      metadata: input.metadata ?? null,
      now,
    });
  }
}
