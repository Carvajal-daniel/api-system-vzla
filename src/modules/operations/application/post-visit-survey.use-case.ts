import {
  buildPostVisitSurveyL0Reply,
  buildPostVisitSurveyPrompt,
  parseSurveyScoreFromText,
  POST_VISIT_SURVEY_DELAY_HOURS,
  POST_VISIT_SURVEY_REPLY_WINDOW_HOURS,
} from "../domain/operations-rules.js";
import type { PostVisitSurveyStatus } from "../infra/database/schema/operations-schema.js";
import type { OperationsNotificationPort } from "./ports/operations-notification.port.js";

export interface DuePostVisitSurveyRecord {
  id: string;
  companyId: string;
  companyName: string;
  appointmentId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  collaboratorName: string;
  scheduledFor: Date;
}

export interface ActiveSentSurveyRecord {
  id: string;
  companyId: string;
  companyName: string;
  googleReviewUrl: string | null;
  appointmentId: string;
  collaboratorId: string;
  collaboratorName: string;
  serviceName: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  sentAt: Date;
}

export interface PostVisitSurveyRepositoryPort {
  scheduleSurveyForClosedOrder(params: {
    companyId: string;
    appointmentId: string;
    clientPhone?: string | null | undefined;
    clientName?: string | null | undefined;
    scheduledFor: Date;
  }): Promise<{ scheduled: boolean; surveyId?: string }>;
  findDuePendingSurveys(now: Date): Promise<DuePostVisitSurveyRecord[]>;
  markSurveySent(params: {
    companyId: string;
    surveyId: string;
    sentAt: Date;
  }): Promise<boolean>;
  findRecentSentSurveyByPhone(params: {
    companyId: string;
    phone: string;
    since: Date;
  }): Promise<ActiveSentSurveyRecord | null>;
  recordSurveyAnswer(params: {
    companyId: string;
    surveyId: string;
    appointmentId: string;
    collaboratorId: string;
    clientId: string;
    clientName: string;
    serviceName: string;
    score: number;
    feedbackText: string | null;
    status: Extract<PostVisitSurveyStatus, "ANSWERED" | "ESCALATED_TO_OWNER">;
    answeredAt: Date;
  }): Promise<boolean>;
  createOwnerAlert(params: {
    companyId: string;
    type: "LOW_SURVEY_SCORE";
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

// Blindagem de Reputação em 2 Passos:
// 1) Ao fechar comanda, agenda pesquisa 1..5 para 2 horas depois.
// 2) Na camada L0 (0 tokens), intercepta resposta numérica 1..5 nas últimas 24h:
//    - Nota 5: envia googleReviewUrl;
//    - Nota 4: agradece cordialmente;
//    - Nota 1..3: não envia link público, acolhe com empatia, marca ESCALATED_TO_OWNER e gera owner_alert urgente.
export class PostVisitSurveyUseCase {
  constructor(
    private readonly repository: PostVisitSurveyRepositoryPort,
    private readonly notificationPort: OperationsNotificationPort,
  ) {}

  async scheduleForClosedOrder(input: {
    companyId: string;
    appointmentId: string | null;
    clientPhone?: string | null | undefined;
    clientName?: string | null | undefined;
    closedAt?: Date | undefined;
  }): Promise<{ scheduled: boolean; surveyId?: string }> {
    if (!input.appointmentId) {
      return { scheduled: false };
    }

    const closedAt = input.closedAt ?? new Date();
    const scheduledFor = new Date(
      closedAt.getTime() + POST_VISIT_SURVEY_DELAY_HOURS * 60 * 60 * 1000,
    );

    return this.repository.scheduleSurveyForClosedOrder({
      companyId: input.companyId,
      appointmentId: input.appointmentId,
      clientPhone: input.clientPhone,
      clientName: input.clientName,
      scheduledFor,
    });
  }

  async dispatchDueSurveys(now: Date = new Date()): Promise<{
    sentCount: number;
    failedCount: number;
  }> {
    const due = await this.repository.findDuePendingSurveys(now);
    let sentCount = 0;
    let failedCount = 0;

    for (const survey of due) {
      const claimed = await this.repository.markSurveySent({
        companyId: survey.companyId,
        surveyId: survey.id,
        sentAt: now,
      });
      if (!claimed) continue;

      const text = buildPostVisitSurveyPrompt({
        clientName: survey.clientName,
        companyName: survey.companyName,
        serviceName: survey.serviceName,
        collaboratorName: survey.collaboratorName,
      });

      const dispatch = await this.notificationPort.sendOperationalMessage({
        companyId: survey.companyId,
        phone: survey.clientPhone,
        clientId: survey.clientId,
        contactName: survey.clientName,
        text,
        kind: "POST_VISIT_SURVEY_PROMPT",
        metadata: {
          surveyId: survey.id,
          appointmentId: survey.appointmentId,
        },
        recordL0Telemetry: true,
        now,
      });

      if (dispatch.delivered) {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    }

    return { sentCount, failedCount };
  }

  async tryHandleInboundL0Reply(input: {
    companyId: string;
    phone: string;
    content: string;
    now?: Date | undefined;
  }): Promise<{
    handled: boolean;
    score?: number;
    status?: "ANSWERED" | "ESCALATED_TO_OWNER";
    replyText?: string;
    ownerAlertId?: string;
  }> {
    const parsed = parseSurveyScoreFromText(input.content);
    if (!parsed) {
      return { handled: false };
    }

    const now = input.now ?? new Date();
    const since = new Date(
      now.getTime() - POST_VISIT_SURVEY_REPLY_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const activeSurvey = await this.repository.findRecentSentSurveyByPhone({
      companyId: input.companyId,
      phone: input.phone,
      since,
    });

    if (!activeSurvey) {
      return { handled: false };
    }

    const nextStatus: "ANSWERED" | "ESCALATED_TO_OWNER" =
      parsed.score <= 3 ? "ESCALATED_TO_OWNER" : "ANSWERED";

    const recorded = await this.repository.recordSurveyAnswer({
      companyId: input.companyId,
      surveyId: activeSurvey.id,
      appointmentId: activeSurvey.appointmentId,
      collaboratorId: activeSurvey.collaboratorId,
      clientId: activeSurvey.clientId,
      clientName: activeSurvey.clientName,
      serviceName: activeSurvey.serviceName,
      score: parsed.score,
      feedbackText: parsed.feedbackText,
      status: nextStatus,
      answeredAt: now,
    });

    if (!recorded) {
      return { handled: false };
    }

    let ownerAlertId: string | undefined;
    if (parsed.score <= 3) {
      const alert = await this.repository.createOwnerAlert({
        companyId: input.companyId,
        type: "LOW_SURVEY_SCORE",
        title: `Alerta de reputação: nota ${parsed.score}/5 de ${activeSurvey.clientName}`,
        description: parsed.feedbackText
          ? `${activeSurvey.clientName} avaliou ${activeSurvey.serviceName} (${activeSurvey.collaboratorName}) com nota ${parsed.score}/5: "${parsed.feedbackText}". Link público bloqueado automaticamente.`
          : `${activeSurvey.clientName} avaliou ${activeSurvey.serviceName} (${activeSurvey.collaboratorName}) com nota ${parsed.score}/5. Link público bloqueado automaticamente para acompanhamento do dono.`,
        metadata: {
          surveyId: activeSurvey.id,
          appointmentId: activeSurvey.appointmentId,
          clientId: activeSurvey.clientId,
          collaboratorId: activeSurvey.collaboratorId,
          score: parsed.score,
          feedbackText: parsed.feedbackText,
        },
      });
      ownerAlertId = alert.id;
    }

    const replyText = buildPostVisitSurveyL0Reply({
      score: parsed.score,
      clientName: activeSurvey.clientName,
      companyName: activeSurvey.companyName,
      googleReviewUrl: parsed.score === 5 ? activeSurvey.googleReviewUrl : null,
    });

    await this.notificationPort.sendOperationalMessage({
      companyId: input.companyId,
      phone: input.phone,
      clientId: activeSurvey.clientId,
      contactName: activeSurvey.clientName,
      text: replyText,
      kind: "POST_VISIT_SURVEY_REPLY",
      metadata: {
        surveyId: activeSurvey.id,
        appointmentId: activeSurvey.appointmentId,
        score: parsed.score,
        status: nextStatus,
        ...(ownerAlertId ? { ownerAlertId } : {}),
      },
      recordL0Telemetry: true,
      now,
    });

    return {
      handled: true,
      score: parsed.score,
      status: nextStatus,
      replyText,
      ...(ownerAlertId ? { ownerAlertId } : {}),
    };
  }
}
