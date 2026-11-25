import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import type { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import type { WhatsAppConversation } from "../../domain/entities/whatsapp-conversation.entity.js";
import { WhatsAppMessage } from "../../domain/entities/whatsapp-message.entity.js";
import type { PostVisitNpsRepository } from "../../domain/repositories/post-visit-nps.repository.js";
import type { WhatsAppConversationsRepository } from "../../domain/repositories/whatsapp-conversations.repository.js";
import type { WhatsAppMessagesRepository } from "../../domain/repositories/whatsapp-messages.repository.js";
import type { ProactiveInsightsWriterPort } from "../ports/proactive-insights-writer.port.js";
import type { WhatsAppGatewayPort } from "../ports/whatsapp-gateway.port.js";
import {
  AI_AUTO_PAUSE_MS,
  type InboundNpsReplyHandlerPort,
} from "./process-inbound-whatsapp-message.use-case.js";

export interface DispatchPostVisitNpsInput {
  tenantId?: string | undefined;
  now?: Date | undefined;
}

export interface DispatchPostVisitNpsOutput {
  sentCount: number;
  skippedQuotaCount: number;
  skippedAlreadySentCount: number;
  failedCount: number;
}

// Extrai nota de 1 a 5 (ex.: "5", "nota 4", "3 - atrasou um pouco") sem capturar datas ou horários.
export function parseNpsRatingFromMessage(content: string): {
  rating: number;
  comment: string | null;
} | null {
  const trimmed = content.trim();
  const match =
    /^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|\/\s*5))?(?:[\s\-:.,!]+([\s\S]+))?$/i.exec(
      trimmed,
    );
  if (!match?.[1]) {
    return null;
  }
  const rating = Number(match[1]);
  const comment = match[2]?.trim() || null;
  return { rating, comment };
}

// Gerencia o ciclo pós-atendimento automatizado (NPS 1 a 5):
// 1) Dispara pesquisa ~1h após a conclusão do atendimento.
// 2) Filtra a nota recebida: 5 -> link Google Maps; 4 -> agradecimento; 1-3 -> acolhimento + pausa 2h + alerta urgente.
export class ProcessPostVisitNpsUseCase implements InboundNpsReplyHandlerPort {
  constructor(
    private readonly npsRepository: PostVisitNpsRepository,
    private readonly conversationsRepository: WhatsAppConversationsRepository,
    private readonly messagesRepository: WhatsAppMessagesRepository,
    private readonly whatsappGateway: WhatsAppGatewayPort,
    private readonly planQuotaGuard: PlanQuotaGuardUseCase,
    private readonly proactiveInsightsWriter: ProactiveInsightsWriterPort,
  ) {}

  public async dispatchPendingSurveys(
    input: DispatchPostVisitNpsInput = {},
  ): Promise<DispatchPostVisitNpsOutput> {
    const now = input.now ?? new Date();
    const eligible = await this.npsRepository.findCompletedEligibleForNps({
      tenantId: input.tenantId,
      now,
    });

    let sentCount = 0;
    let skippedQuotaCount = 0;
    let skippedAlreadySentCount = 0;
    let failedCount = 0;

    for (const appt of eligible) {
      const quota = await this.planQuotaGuard.checkCanSendOutbound(
        appt.companyId,
        now,
      );
      if (!quota.allowed) {
        skippedQuotaCount += 1;
        continue;
      }

      let normalizedPhone: string;
      try {
        normalizedPhone = Phone.create(appt.clientPhone).value;
      } catch {
        failedCount += 1;
        continue;
      }

      const claimed = await this.npsRepository.markNpsSent({
        companyId: appt.companyId,
        appointmentId: appt.appointmentId,
        sentAt: now,
      });
      if (!claimed) {
        skippedAlreadySentCount += 1;
        continue;
      }

      const text = [
        `Olá, ${appt.clientName}! 😊`,
        `Como foi seu atendimento de *${appt.serviceName}* com *${appt.collaboratorName}* na *${appt.companyName}*?`,
        "Responda com uma nota de *1 a 5* (sendo 5 excelente) para nos ajudar a melhorar sempre!",
      ].join("\n");

      try {
        const dispatch = await this.whatsappGateway.sendText({
          tenantId: appt.companyId,
          to: normalizedPhone,
          text,
          purpose: "RECEPTION",
        });

        const conversation = await this.conversationsRepository.upsertOutbound({
          companyId: appt.companyId,
          phone: normalizedPhone,
          clientId: null,
          contactName: appt.clientName,
          sentAt: now,
          status: "WAITING_CLIENT",
        });

        const outboundMessage = WhatsAppMessage.create({
          companyId: appt.companyId,
          conversationId: conversation.id,
          externalMessageId: dispatch.externalMessageId ?? null,
          direction: "OUTBOUND",
          senderType: "AI_AGENT",
          content: text,
          metadata: {
            type: "POST_VISIT_NPS_PROMPT",
            appointmentId: appt.appointmentId,
          },
          sentAt: now,
        });

        await this.messagesRepository.createIdempotent(outboundMessage);

        await this.planQuotaGuard.recordAiUsage({
          tenantId: appt.companyId,
          feature: "RETENTION",
          model: "whatsapp-nps",
          promptTokens: 0,
          completionTokens: 0,
          incrementOutbound: true,
          metadata: { appointmentId: appt.appointmentId },
          now,
        });

        sentCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return {
      sentCount,
      skippedQuotaCount,
      skippedAlreadySentCount,
      failedCount,
    };
  }

  public async tryHandleInboundReply(input: {
    companyId: string;
    conversation: WhatsAppConversation;
    phone: string;
    content: string;
    now: Date;
  }): Promise<{
    handled: boolean;
    conversation?: WhatsAppConversation;
    outboundMessage?: WhatsAppMessage | null;
  }> {
    const parsed = parseNpsRatingFromMessage(input.content);
    if (!parsed) {
      return { handled: false };
    }

    const pending = await this.npsRepository.findPendingNpsForPhone({
      companyId: input.companyId,
      phone: input.phone,
      now: input.now,
    });
    if (!pending) {
      return { handled: false };
    }

    const recorded = await this.npsRepository.recordNpsResponse({
      companyId: input.companyId,
      appointmentId: pending.appointmentId,
      collaboratorId: pending.collaboratorId,
      clientId: input.conversation.clientId,
      clientName: pending.clientName,
      serviceName: pending.serviceName,
      rating: parsed.rating,
      comment: parsed.comment,
      respondedAt: input.now,
    });

    if (!recorded) {
      return { handled: false };
    }

    let currentConversation = input.conversation;
    let replyText: string;

    if (parsed.rating === 5) {
      replyText = pending.googleMapsUrl
        ? `Que alegria receber sua nota 5, ${pending.clientName}! 🙌 Muito obrigado pela confiança na ${pending.companyName}. Se puder deixar sua avaliação no Google também, nos ajuda demais: ${pending.googleMapsUrl}`
        : `Que alegria receber sua nota 5, ${pending.clientName}! 🙌 Muito obrigado pela confiança na ${pending.companyName}. Esperamos você no próximo atendimento!`;
    } else if (parsed.rating === 4) {
      replyText = `Muito obrigado pela sua nota 4 e pelo feedback positivo, ${pending.clientName}! 😊 Ficamos felizes em atender você na ${pending.companyName} e já te esperamos para o próximo corte!`;
    } else {
      // Notas 1, 2 ou 3: acolhe com empatia (sem link do Google), pausa IA por 2h e cria alerta urgente.
      replyText = `Lamentamos muito que sua experiência não tenha sido como esperado, ${pending.clientName}. Agradecemos sua sinceridade — nossa equipe responsável já foi avisada e vai acompanhar pessoalmente para resolver isso com você.`;

      const aiPausedUntil = new Date(input.now.getTime() + AI_AUTO_PAUSE_MS);
      if (this.conversationsRepository.updateAiPauseState) {
        currentConversation =
          (await this.conversationsRepository.updateAiPauseState({
            companyId: input.companyId,
            conversationId: currentConversation.id,
            aiPausedUntil,
          })) ?? currentConversation;
      }

      await this.proactiveInsightsWriter.createInsight({
        tenantId: input.companyId,
        module: "CLIENTS",
        type: "NEGATIVE_NPS_ALERT",
        title: `Avaliação negativa (${parsed.rating}/5) de ${pending.clientName}`,
        description: parsed.comment
          ? `${pending.clientName} avaliou ${pending.serviceName} (${pending.collaboratorName}) com nota ${parsed.rating}/5: "${parsed.comment}". A IA foi pausada por 2h para atendimento humano.`
          : `${pending.clientName} avaliou ${pending.serviceName} (${pending.collaboratorName}) com nota ${parsed.rating}/5. A IA foi pausada por 2h para atendimento humano.`,
        impactLabel: `Nota ${parsed.rating}/5`,
        actionPayload: {
          appointmentId: pending.appointmentId,
          conversationId: currentConversation.id,
          collaboratorId: pending.collaboratorId,
          rating: parsed.rating,
          comment: parsed.comment,
        },
      });
    }

    let externalReferenceId: string | null = null;
    try {
      const dispatch = await this.whatsappGateway.sendText({
        tenantId: input.companyId,
        to: input.phone,
        text: replyText,
        purpose: "RECEPTION",
      });
      externalReferenceId = dispatch.externalMessageId ?? null;
    } catch {
      // Mantém avaliação salva e mensagem registrada na inbox mesmo se o envio falhar.
    }

    const outboundEntity = WhatsAppMessage.create({
      companyId: input.companyId,
      conversationId: currentConversation.id,
      externalMessageId: externalReferenceId,
      direction: "OUTBOUND",
      senderType: "AI_AGENT",
      content: replyText,
      metadata: {
        type: "POST_VISIT_NPS_REPLY",
        appointmentId: pending.appointmentId,
        rating: parsed.rating,
      },
      sentAt: input.now,
    });

    const { message: savedOutbound } =
      await this.messagesRepository.createIdempotent(outboundEntity);

    const updatedConversation =
      (await this.conversationsRepository.touchAfterOutbound({
        companyId: input.companyId,
        conversationId: currentConversation.id,
        sentAt: input.now,
        status: parsed.rating <= 3 ? "OPEN" : "WAITING_CLIENT",
      })) ?? currentConversation;

    return {
      handled: true,
      conversation: updatedConversation,
      outboundMessage: savedOutbound,
    };
  }
}
