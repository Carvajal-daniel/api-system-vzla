import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type { WhatsAppGatewayPort } from "../../../whatsapp/application/ports/whatsapp-gateway.port.js";
import type { ProactiveInsightRecord } from "../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../domain/repositories/intelligence-data.repository.js";
import type {
  ListProactiveInsightsParams,
  ListProactiveInsightsResult,
  ProactiveInsightsRepository,
} from "../../domain/repositories/proactive-insights.repository.js";
import type { IntelligenceAiPort } from "../ports/intelligence-ai.port.js";

export class ProactiveInsightNotFoundError extends Error {
  public readonly statusCode = 404;

  constructor(message = "Insight não encontrado para esta empresa.") {
    super(message);
    this.name = "ProactiveInsightNotFoundError";
  }
}

export class ProactiveInsightQuotaExceededError extends Error {
  public readonly statusCode = 402;

  constructor(message: string) {
    super(message);
    this.name = "ProactiveInsightQuotaExceededError";
  }
}

export interface RefreshProactiveInsightsResult {
  tenantId: string;
  createdCount: number;
  skippedDuplicateCount: number;
  insights: ProactiveInsightRecord[];
}

export interface ExecuteProactiveInsightResult {
  insight: ProactiveInsightRecord;
  dispatchedMessagesCount: number;
  skippedQuotaCount: number;
}

// Orquestra o Motor Proativo de Insights: gera oportunidades por módulo sem duplicação diária
// e executa/descarta cards com isolamento estrito por tenantId.
export class ProactiveIntelligenceUseCase {
  constructor(
    private readonly dataRepository: IntelligenceDataRepository,
    private readonly insightsRepository: ProactiveInsightsRepository,
    private readonly aiPort: IntelligenceAiPort,
    private readonly whatsappGateway: WhatsAppGatewayPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
  ) {}

  public async listInsights(
    params: ListProactiveInsightsParams,
  ): Promise<ListProactiveInsightsResult> {
    return this.insightsRepository.listByTenant(params);
  }

  public async refreshForTenant(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<RefreshProactiveInsightsResult> {
    const metrics = await this.dataRepository.getProactiveScanMetrics(
      tenantId,
      now,
    );
    const aiResult = await this.aiPort.generateProactiveInsights(metrics);

    await this.planQuotaGuard.recordAiUsage({
      tenantId,
      feature: "INSIGHTS",
      model: aiResult.usage.model,
      promptTokens: aiResult.usage.promptTokens,
      completionTokens: aiResult.usage.completionTokens,
      incrementOutbound: false,
      metadata: {
        candidatesCount: aiResult.insights.length,
      },
      now,
    });

    const created: ProactiveInsightRecord[] = [];
    let skippedDuplicateCount = 0;

    for (const candidate of aiResult.insights) {
      const alreadyPendingToday =
        await this.insightsRepository.existsPendingTodayByType(
          tenantId,
          candidate.type,
          now,
        );
      if (alreadyPendingToday) {
        skippedDuplicateCount += 1;
        continue;
      }

      const saved = await this.insightsRepository.create({
        tenantId,
        module: candidate.module,
        type: candidate.type,
        title: candidate.title,
        description: candidate.description,
        impactLabel: candidate.impactLabel,
        actionPayload: candidate.actionPayload,
        expiresAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      });
      created.push(saved);
    }

    return {
      tenantId,
      createdCount: created.length,
      skippedDuplicateCount,
      insights: created,
    };
  }

  public async executeInsight(
    tenantId: string,
    insightId: string,
    now: Date = new Date(),
  ): Promise<ExecuteProactiveInsightResult> {
    const insight = await this.insightsRepository.findByIdForTenant(
      tenantId,
      insightId,
    );
    if (!insight) {
      throw new ProactiveInsightNotFoundError();
    }

    if (insight.status === "EXECUTED") {
      return {
        insight,
        dispatchedMessagesCount: 0,
        skippedQuotaCount: 0,
      };
    }

    let dispatchedMessagesCount = 0;
    let skippedQuotaCount = 0;

    const payload = insight.actionPayload;
    if (payload && typeof payload === "object") {
      const actionType =
        typeof payload.actionType === "string" ? payload.actionType : null;

      if (
        actionType === "SEND_APOLOGY_WHATSAPP" &&
        typeof payload.clientPhone === "string" &&
        typeof payload.draftMessage === "string"
      ) {
        const quota = await this.planQuotaGuard.checkCanSendOutbound(
          tenantId,
          now,
        );
        if (!quota.allowed) {
          throw new ProactiveInsightQuotaExceededError(
            quota.reason ?? "Limite mensal de disparos WhatsApp atingido.",
          );
        }

        const normalizedPhone = Phone.create(payload.clientPhone).value;
        await this.whatsappGateway.sendText({
          tenantId,
          to: normalizedPhone,
          text: payload.draftMessage,
          purpose: "RECEPTION",
        });

        await this.planQuotaGuard.recordAiUsage({
          tenantId,
          feature: "RETENTION",
          model: "manual-approval",
          promptTokens: 0,
          completionTokens: 0,
          incrementOutbound: true,
          metadata: {
            insightId: insight.id,
            actionType,
          },
          now,
        });
        dispatchedMessagesCount = 1;
      } else if (
        actionType === "WHATSAPP_BROADCAST" &&
        Array.isArray(payload.recipients) &&
        typeof payload.messageTemplate === "string"
      ) {
        for (const rawRecipient of payload.recipients) {
          if (
            !rawRecipient ||
            typeof rawRecipient !== "object" ||
            typeof (rawRecipient as { clientPhone?: unknown }).clientPhone !==
              "string"
          ) {
            continue;
          }

          const recipient = rawRecipient as {
            clientName?: string;
            clientPhone: string;
          };

          const quota = await this.planQuotaGuard.checkCanSendOutbound(
            tenantId,
            now,
          );
          if (!quota.allowed) {
            skippedQuotaCount += 1;
            continue;
          }

          let normalizedPhone: string;
          try {
            normalizedPhone = Phone.create(recipient.clientPhone).value;
          } catch {
            continue;
          }

          const text = payload.messageTemplate.replace(
            /\{\{name\}\}/g,
            recipient.clientName?.trim() || "cliente",
          );

          await this.whatsappGateway.sendText({
            tenantId,
            to: normalizedPhone,
            text,
            purpose: "CAMPAIGN",
          });

          await this.planQuotaGuard.recordAiUsage({
            tenantId,
            feature: "INSIGHTS",
            model: "insight-action",
            promptTokens: 0,
            completionTokens: 0,
            incrementOutbound: true,
            metadata: {
              insightId: insight.id,
              actionType,
            },
            now,
          });
          dispatchedMessagesCount += 1;
        }
      }
    }

    const updated = await this.insightsRepository.updateStatusForTenant(
      tenantId,
      insightId,
      "EXECUTED",
    );

    if (!updated) {
      throw new ProactiveInsightNotFoundError();
    }

    return {
      insight: updated,
      dispatchedMessagesCount,
      skippedQuotaCount,
    };
  }

  public async dismissInsight(
    tenantId: string,
    insightId: string,
  ): Promise<ProactiveInsightRecord> {
    const updated = await this.insightsRepository.updateStatusForTenant(
      tenantId,
      insightId,
      "DISMISSED",
    );
    if (!updated) {
      throw new ProactiveInsightNotFoundError();
    }
    return updated;
  }
}
