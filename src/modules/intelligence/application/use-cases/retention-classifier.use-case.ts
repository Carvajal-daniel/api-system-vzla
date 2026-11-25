import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import { WhatsAppMessage } from "../../../whatsapp/domain/entities/whatsapp-message.entity.js";
import type { WhatsAppConversationsRepository } from "../../../whatsapp/domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../../whatsapp/domain/repositories/whatsapp-messages.repository.js";
import type { WhatsAppGatewayPort } from "../../../whatsapp/application/ports/whatsapp-gateway.port.js";
import type {
  InactiveClientCandidate,
  RetentionTrack,
} from "../../domain/entities/proactive-insight.types.js";
import type { IntelligenceDataRepository } from "../../domain/repositories/intelligence-data.repository.js";
import type { ProactiveInsightsRepository } from "../../domain/repositories/proactive-insights.repository.js";
import type { IntelligenceAiPort } from "../ports/intelligence-ai.port.js";

const DEFAULT_MIN_DRIP_MS = 45_000;
const DEFAULT_MAX_DRIP_MS = 90_000;

const COMPLAINT_PATTERN =
  /(reclama|ruim|pessimo|péssimo|horrivel|horrível|atras|mal feito|nao gostei|não gostei|insatisfeit|decepcion|nunca mais)/i;

// Classifica determinísticamente o cliente sumido antes de chamar o Gemini.
// Regra crítica: nota 1, 2 ou 3 (ou comentário de reclamação) SEMPRE vai para Trilha 3 (bloqueio automático).
export function classifyInactiveClientTrack(
  client: InactiveClientCandidate,
): RetentionTrack {
  const hasNegativeRating =
    client.lastReviewRating !== null && client.lastReviewRating <= 3;
  const hasComplaintComment = Boolean(
    client.lastReviewComment &&
      COMPLAINT_PATTERN.test(client.lastReviewComment),
  );

  if (hasNegativeRating || hasComplaintComment) {
    return "TRACK_3_UNHAPPY";
  }

  if (client.lastAppointmentStatus === "CANCELED") {
    return "TRACK_2_CANCELED";
  }

  return "TRACK_1_SATISFIED";
}

export interface RetentionClassifierOptions {
  sleep?: ((ms: number) => Promise<void>) | undefined;
  randomDripDelayMs?: (() => number) | undefined;
}

export interface RetentionRunOutput {
  tenantId: string;
  scannedCount: number;
  track1SentCount: number;
  track2SentCount: number;
  track3CardsCreatedCount: number;
  skippedQuotaCount: number;
  failedCount: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultRandomDripDelayMs(): number {
  return (
    DEFAULT_MIN_DRIP_MS +
    Math.floor(Math.random() * (DEFAULT_MAX_DRIP_MS - DEFAULT_MIN_DRIP_MS + 1))
  );
}

// Resgate inteligente de clientes sumidos (>30d sem COMPLETED) em 3 trilhas com gotejamento seguro.
export class RetentionClassifierUseCase {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly randomDripDelayMs: () => number;

  constructor(
    private readonly dataRepository: IntelligenceDataRepository,
    private readonly insightsRepository: ProactiveInsightsRepository,
    private readonly aiPort: IntelligenceAiPort,
    private readonly whatsappGateway: WhatsAppGatewayPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
    private readonly conversationsRepository?: WhatsAppConversationsRepository,
    private readonly messagesRepository?: WhatsAppMessagesRepository,
    options: RetentionClassifierOptions = {},
  ) {
    this.sleep = options.sleep ?? defaultSleep;
    this.randomDripDelayMs =
      options.randomDripDelayMs ?? defaultRandomDripDelayMs;
  }

  public async executeForTenant(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<RetentionRunOutput> {
    const [candidates, briefing] = await Promise.all([
      this.dataRepository.findInactiveClientsForRetention(tenantId, now),
      this.dataRepository.getDailyBriefingSnapshot(tenantId, now),
    ]);

    const companyName = briefing?.companyName ?? "Sua Empresa";

    let track1SentCount = 0;
    let track2SentCount = 0;
    let track3CardsCreatedCount = 0;
    let skippedQuotaCount = 0;
    let failedCount = 0;
    let totalSentOutbound = 0;

    for (const client of candidates) {
      const track = classifyInactiveClientTrack(client);

      if (track === "TRACK_3_UNHAPPY") {
        // Trilha 3: NUNCA envia mensagem automática. Gera rascunho de desculpas e cria card PENDING para o dono.
        const generated = await this.aiPort.generateRetentionMessage({
          companyName,
          track,
          client,
        });

        await this.planQuotaGuard.recordAiUsage({
          tenantId,
          feature: "RETENTION",
          model: generated.usage.model,
          promptTokens: generated.usage.promptTokens,
          completionTokens: generated.usage.completionTokens,
          incrementOutbound: false,
          metadata: {
            track,
            clientId: client.clientId,
            rating: client.lastReviewRating,
          },
          now,
        });

        const ratingLabel =
          client.lastReviewRating !== null
            ? `nota ${client.lastReviewRating}/5`
            : "reclamação registrada";

        await this.insightsRepository.create({
          tenantId,
          module: "CLIENTS",
          type: "UNHAPPY_CLIENT_RESCUE",
          title: `Resgate sensível: ${client.clientName} (${ratingLabel})`,
          description: `${client.clientName} está há ${client.daysSinceLastVisit} dias sem retornar após ${ratingLabel}${client.lastReviewComment ? ` ("${client.lastReviewComment}")` : ""}. Revise e aprove o pedido de desculpas antes de enviar.`,
          impactLabel: "Revisão manual obrigatória",
          actionPayload: {
            actionType: "SEND_APOLOGY_WHATSAPP",
            clientId: client.clientId,
            clientName: client.clientName,
            clientPhone: client.clientPhone,
            rating: client.lastReviewRating,
            comment: client.lastReviewComment,
            draftMessage: generated.text,
          },
          expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        });

        track3CardsCreatedCount += 1;
        continue;
      }

      // Trilhas 1 e 2: verifica cota mensal de disparos antes de acionar Gemini/WhatsApp.
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
        normalizedPhone = Phone.create(client.clientPhone).value;
      } catch {
        failedCount += 1;
        continue;
      }

      // Gotejamento seguro (45s-90s entre disparos consecutivos) para proteger o número contra bloqueio.
      if (totalSentOutbound > 0) {
        const delayMs = this.randomDripDelayMs();
        if (delayMs > 0) {
          await this.sleep(delayMs);
        }
      }

      const generated = await this.aiPort.generateRetentionMessage({
        companyName,
        track,
        client,
      });

      try {
        const dispatch = await this.whatsappGateway.sendText({
          tenantId,
          to: normalizedPhone,
          text: generated.text,
          purpose: "CAMPAIGN",
        });

        if (this.conversationsRepository && this.messagesRepository) {
          const conversation =
            await this.conversationsRepository.upsertOutbound({
              companyId: tenantId,
              phone: normalizedPhone,
              clientId: client.clientId,
              contactName: client.clientName,
              sentAt: now,
              status: "WAITING_CLIENT",
            });

          await this.messagesRepository.createIdempotent(
            WhatsAppMessage.create({
              companyId: tenantId,
              conversationId: conversation.id,
              externalMessageId: dispatch.externalMessageId ?? null,
              direction: "OUTBOUND",
              senderType: "AI_AGENT",
              content: generated.text,
              metadata: {
                feature: "RETENTION",
                track,
                clientId: client.clientId,
              },
              sentAt: now,
            }),
          );
        }

        await this.planQuotaGuard.recordAiUsage({
          tenantId,
          feature: "RETENTION",
          model: generated.usage.model,
          promptTokens: generated.usage.promptTokens,
          completionTokens: generated.usage.completionTokens,
          incrementOutbound: true,
          metadata: {
            track,
            clientId: client.clientId,
          },
          now,
        });

        totalSentOutbound += 1;
        if (track === "TRACK_1_SATISFIED") {
          track1SentCount += 1;
        } else {
          track2SentCount += 1;
        }
      } catch {
        failedCount += 1;
      }
    }

    return {
      tenantId,
      scannedCount: candidates.length,
      track1SentCount,
      track2SentCount,
      track3CardsCreatedCount,
      skippedQuotaCount,
      failedCount,
    };
  }
}
