import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type { WhatsAppGatewayPort } from "../../../whatsapp/application/ports/whatsapp-gateway.port.js";
import type { DailyBriefingSnapshot } from "../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../domain/repositories/intelligence-data.repository.js";

function formatBrl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatDailyOwnerBriefingMessage(
  snapshot: DailyBriefingSnapshot,
): string {
  const idleLine =
    snapshot.criticalIdleSlotsCount > 0
      ? `• Horários vagos críticos (48h): ${snapshot.criticalIdleSummary.join(", ")}`
      : "• Horários vagos críticos (48h): nenhum alerta crítico";

  return [
    `Bom dia! ☀️ Resumo diário — *${snapshot.companyName}* (${snapshot.referenceDate})`,
    "",
    `• Agendamentos hoje: *${snapshot.confirmedAppointmentsToday} confirmados* e *${snapshot.pendingAppointmentsToday} pendentes*`,
    `• Faturamento previsto do dia: *${formatBrl(snapshot.projectedRevenueTodayCents)}*`,
    idleLine,
    `• Insights proativos pendentes: *${snapshot.pendingInsightsCount}*`,
    "",
    "Abra o painel de Inteligência para aprovar ações com 1 clique.",
  ].join("\n");
}

export interface DailyBriefingExecutionResult {
  tenantId: string;
  status: "SENT" | "SKIPPED_NO_PHONE" | "SKIPPED_QUOTA" | "NOT_FOUND";
  message?: string;
}

// Compila o resumo matinal do dono e envia no WhatsApp configurado respeitando a cota mensal.
export class GenerateDailyOwnerBriefingUseCase {
  constructor(
    private readonly dataRepository: IntelligenceDataRepository,
    private readonly whatsappGateway: WhatsAppGatewayPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
  ) {}

  public async executeForTenant(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<DailyBriefingExecutionResult> {
    const snapshot = await this.dataRepository.getDailyBriefingSnapshot(
      tenantId,
      now,
    );
    if (!snapshot) {
      return { tenantId, status: "NOT_FOUND" };
    }

    if (!snapshot.ownerPhone) {
      return { tenantId, status: "SKIPPED_NO_PHONE" };
    }

    const quota = await this.planQuotaGuard.checkCanSendOutbound(tenantId, now);
    if (!quota.allowed) {
      return { tenantId, status: "SKIPPED_QUOTA" };
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = Phone.create(snapshot.ownerPhone).value;
    } catch {
      return { tenantId, status: "SKIPPED_NO_PHONE" };
    }

    const message = formatDailyOwnerBriefingMessage(snapshot);
    await this.whatsappGateway.sendText({
      tenantId,
      to: normalizedPhone,
      text: message,
      purpose: "RECEPTION",
    });

    await this.planQuotaGuard.recordAiUsage({
      tenantId,
      feature: "INSIGHTS",
      model: "daily-owner-briefing",
      promptTokens: 0,
      completionTokens: 0,
      incrementOutbound: true,
      metadata: {
        type: "DAILY_OWNER_BRIEFING",
        referenceDate: snapshot.referenceDate,
      },
      now,
    });

    return {
      tenantId,
      status: "SENT",
      message,
    };
  }
}
