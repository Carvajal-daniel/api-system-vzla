import { DomainError, type DomainErrorCode } from "../../../shared/Errors/domain-error.js";
import type { WaitlistShift } from "../infra/database/schema/operations-schema.js";

export class OperationsDomainError extends DomainError {
  constructor(message: string, code: DomainErrorCode, reasonCode?: string) {
    super(message, code, reasonCode);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const WAITLIST_OFFER_WINDOW_MINUTES = 20;
export const POST_VISIT_SURVEY_DELAY_HOURS = 2;
export const POST_VISIT_SURVEY_REPLY_WINDOW_HOURS = 24;
export const DEFAULT_CHURN_MARGIN_DAYS = 4;

// Classifica o turno operacional com base na hora local (0..23) do estabelecimento.
export function shiftFromLocalHour(hour: number): Exclude<WaitlistShift, "ANY"> {
  if (hour < 12) return "MORNING";
  if (hour < 18) return "AFTERNOON";
  return "EVENING";
}

export function isShiftCompatible(
  preferredShift: WaitlistShift,
  localHour: number,
): boolean {
  if (preferredShift === "ANY") return true;
  return preferredShift === shiftFromLocalHour(localHour);
}

// Extrai resposta numérica de 1 a 5 na camada L0 (zero tokens de LLM).
export function parseSurveyScoreFromText(content: string): {
  score: number;
  feedbackText: string | null;
} | null {
  const trimmed = content.trim();
  const match =
    /^(?:nota\s*)?([1-5])(?:\s*(?:estrelas?|\/\s*5))?(?:[\s\-:.,!]+([\s\S]+))?$/i.exec(
      trimmed,
    );
  if (!match?.[1]) {
    return null;
  }
  const score = Number(match[1]);
  const feedbackText = match[2]?.trim() || null;
  return { score, feedbackText };
}

export interface ClientVisitHistory {
  clientId: string;
  clientName: string;
  clientPhone: string;
  lastServiceName: string | null;
  lastCollaboratorName: string | null;
  completedVisitDates: Date[];
}

export type ChurnRiskLevel = "WARNING" | "HIGH_RISK";

export interface IndividualChurnCandidate {
  clientId: string;
  clientName: string;
  clientPhone: string;
  visitCount: number;
  averageCycleDays: number;
  daysSinceLastVisit: number;
  overdueDays: number;
  risk: ChurnRiskLevel;
  lastVisitAt: string;
  lastServiceName: string | null;
  lastCollaboratorName: string | null;
}

// Calcula o Radar de Churn individual usando o ciclo médio real entre visitas concluídas (mínimo 2 visitas).
export function computeIndividualChurnRadar(
  histories: ClientVisitHistory[],
  now: Date,
  marginDays: number = DEFAULT_CHURN_MARGIN_DAYS,
): IndividualChurnCandidate[] {
  const safeMargin = Math.max(1, marginDays);
  const candidates: IndividualChurnCandidate[] = [];

  for (const history of histories) {
    if (history.completedVisitDates.length < 2) {
      continue;
    }

    const sorted = [...history.completedVisitDates].sort(
      (a, b) => a.getTime() - b.getTime(),
    );

    let totalIntervalDays = 0;
    let intervalCount = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const diffDays = (sorted[i]!.getTime() - sorted[i - 1]!.getTime()) / DAY_MS;
      if (diffDays > 0) {
        totalIntervalDays += diffDays;
        intervalCount += 1;
      }
    }

    if (intervalCount === 0) {
      continue;
    }

    const averageCycleDays = Math.round((totalIntervalDays / intervalCount) * 10) / 10;
    const lastVisit = sorted[sorted.length - 1]!;
    const daysSinceLastVisit = Math.max(
      0,
      Math.floor((now.getTime() - lastVisit.getTime()) / DAY_MS),
    );
    const overdueDays = Math.round((daysSinceLastVisit - averageCycleDays) * 10) / 10;

    if (overdueDays < safeMargin) {
      continue;
    }

    // Risco alto quando o atraso atinge pelo menos o dobro da margem ou metade do ciclo médio próprio.
    const highRiskThreshold = Math.max(safeMargin * 2, Math.round(averageCycleDays * 0.5));
    const risk: ChurnRiskLevel =
      overdueDays >= highRiskThreshold ? "HIGH_RISK" : "WARNING";

    candidates.push({
      clientId: history.clientId,
      clientName: history.clientName,
      clientPhone: history.clientPhone,
      visitCount: sorted.length,
      averageCycleDays,
      daysSinceLastVisit,
      overdueDays,
      risk,
      lastVisitAt: lastVisit.toISOString(),
      lastServiceName: history.lastServiceName,
      lastCollaboratorName: history.lastCollaboratorName,
    });
  }

  return candidates.sort((a, b) => {
    if (a.risk !== b.risk) return a.risk === "HIGH_RISK" ? -1 : 1;
    return b.overdueDays - a.overdueDays;
  });
}

export function formatLocalTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function buildCascadeDelayMessage(params: {
  clientName: string;
  collaboratorName: string;
  delayMinutes: number;
  newStartsAt: Date;
  timezone: string;
}): string {
  const newTime = formatLocalTime(params.newStartsAt, params.timezone);
  return `Olá, ${params.clientName}! Passando para avisar com carinho que a agenda de ${params.collaboratorName} teve um pequeno atraso de ${params.delayMinutes} minutos hoje. Seu novo horário previsto ficou para às ${newTime}. Pedimos desculpas pelo imprevisto e agradecemos a compreensão!`;
}

export function buildEmergencyAbsenceMessage(params: {
  clientName: string;
  absentCollaboratorName: string;
  originalStartsAt: Date;
  timezone: string;
  alternative?: {
    collaboratorName: string;
    startsAt: Date;
  } | null;
}): string {
  const origDate = formatLocalDate(params.originalStartsAt, params.timezone);
  const origTime = formatLocalTime(params.originalStartsAt, params.timezone);

  if (params.alternative) {
    const altTime = formatLocalTime(params.alternative.startsAt, params.timezone);
    return `Olá, ${params.clientName}! Tivemos um imprevisto com ${params.absentCollaboratorName} e precisaremos ajustar seu horário de ${origDate} às ${origTime}. Para não te deixar na mão, já separamos uma opção de encaixe imediato com ${params.alternative.collaboratorName} às ${altTime}. Podemos confirmar esse encaixe para você?`;
  }

  return `Olá, ${params.clientName}! Tivemos um imprevisto na agenda de ${params.absentCollaboratorName} no dia ${origDate} às ${origTime}. Você tem prioridade total para remarcarmos no melhor horário para você — responda esta mensagem com sua preferência que ajustamos na hora!`;
}

export function buildWaitlistOfferMessage(params: {
  clientName: string;
  companyName: string;
  slotStartsAt: Date;
  collaboratorName: string;
  timezone: string;
}): string {
  const dateLabel = formatLocalDate(params.slotStartsAt, params.timezone);
  const timeLabel = formatLocalTime(params.slotStartsAt, params.timezone);
  return `Olá, ${params.clientName}! Acabou de abrir uma vaga na ${params.companyName} para o dia ${dateLabel} às ${timeLabel} com ${params.collaboratorName}. Como você está na nossa fila de espera, reservamos prioridade por 20 minutos! Responda *SIM* para garantir esse horário.`;
}

export function buildPostVisitSurveyPrompt(params: {
  clientName: string;
  companyName: string;
  serviceName: string;
  collaboratorName: string;
}): string {
  return [
    `Olá, ${params.clientName}! 😊`,
    `Como foi seu atendimento de *${params.serviceName}* com *${params.collaboratorName}* na *${params.companyName}*?`,
    "Responda com uma nota de *1 a 5* (sendo 5 excelente) para nos ajudar a melhorar sempre!",
  ].join("\n");
}

export function buildPostVisitSurveyL0Reply(params: {
  score: number;
  clientName: string;
  companyName: string;
  googleReviewUrl: string | null;
}): string {
  if (params.score === 5) {
    if (params.googleReviewUrl) {
      return `Que alegria receber sua nota 5, ${params.clientName}! 🙌 Muito obrigado pela confiança na ${params.companyName}. Se puder deixar sua avaliação no Google também, nos ajuda demais: ${params.googleReviewUrl}`;
    }
    return `Que alegria receber sua nota 5, ${params.clientName}! 🙌 Muito obrigado pela confiança na ${params.companyName}. Esperamos você no próximo atendimento!`;
  }

  if (params.score === 4) {
    return `Muito obrigado pela sua nota 4 e pelo feedback, ${params.clientName}! 😊 Ficamos felizes em atender você na ${params.companyName} e já te esperamos na próxima visita!`;
  }

  return `Lamentamos muito que sua experiência não tenha sido como esperado, ${params.clientName}. Agradecemos sua sinceridade — o responsável pela ${params.companyName} já foi avisado e vai acompanhar pessoalmente para resolver isso com você.`;
}

export function buildChurnReactivationMessage(params: {
  clientName: string;
  companyName: string;
  lastServiceName: string | null;
  averageCycleDays: number;
}): string {
  const serviceHint = params.lastServiceName
    ? ` do seu último ${params.lastServiceName}`
    : "";
  return `Olá, ${params.clientName}! Sentimos sua falta por aqui na ${params.companyName} 😊 Notamos que normalmente você passa a cada ~${Math.round(params.averageCycleDays)} dias e já faz um tempinho${serviceHint}. Quer que a gente separe um horário especial para você esta semana?`;
}
