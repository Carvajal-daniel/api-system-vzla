import { randomUUID } from "node:crypto";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export type DetectedObjection =
  | "NONE"
  | "TIMING"
  | "SCHEDULE_FULL"
  | "PRICE"
  | "PAYMENT_METHOD"
  | "OTHER";

export interface AiConversationInsightProps {
  id: string;
  companyId: string;
  conversationId: string;
  leadTemperature: LeadTemperature;
  leadScore: number;
  summary: string;
  detectedObjection: DetectedObjection;
  recommendedNextAction: string;
  suggestedFollowupReply: string;
  analyzedAt: Date;
  updatedAt: Date;
}

export interface AiConversationInsightDTO {
  id: string;
  companyId: string;
  conversationId: string;
  leadTemperature: LeadTemperature;
  leadScore: number;
  summary: string;
  detectedObjection: DetectedObjection;
  recommendedNextAction: string;
  suggestedFollowupReply: string;
  analyzedAt: string;
  updatedAt: string;
}

const VALID_TEMPERATURES: ReadonlySet<LeadTemperature> = new Set([
  "HOT",
  "WARM",
  "COLD",
]);

const VALID_OBJECTIONS: ReadonlySet<DetectedObjection> = new Set([
  "NONE",
  "TIMING",
  "SCHEDULE_FULL",
  "PRICE",
  "PAYMENT_METHOD",
  "OTHER",
]);

// Entidade de domínio que encapsula a inteligência comercial extraída de uma conversa de WhatsApp.
export class AiConversationInsight {
  private readonly props: AiConversationInsightProps;

  private constructor(props: AiConversationInsightProps) {
    this.props = props;
  }

  public static create(input: {
    id?: string | undefined;
    companyId: string;
    conversationId: string;
    leadTemperature: LeadTemperature;
    leadScore: number;
    summary: string;
    detectedObjection: DetectedObjection;
    recommendedNextAction: string;
    suggestedFollowupReply: string;
    analyzedAt?: Date | undefined;
    updatedAt?: Date | undefined;
  }): AiConversationInsight {
    const now = new Date();
    const clampedScore = Math.max(
      0,
      Math.min(100, Math.round(Number.isFinite(input.leadScore) ? input.leadScore : 50)),
    );
    const temperature: LeadTemperature = VALID_TEMPERATURES.has(
      input.leadTemperature,
    )
      ? input.leadTemperature
      : "WARM";
    const objection: DetectedObjection = VALID_OBJECTIONS.has(
      input.detectedObjection,
    )
      ? input.detectedObjection
      : "NONE";

    return new AiConversationInsight({
      id: input.id ?? randomUUID(),
      companyId: input.companyId,
      conversationId: input.conversationId,
      leadTemperature: temperature,
      leadScore: clampedScore,
      summary: input.summary.trim() || "Conversa em andamento sem resumo detalhado.",
      detectedObjection: objection,
      recommendedNextAction:
        input.recommendedNextAction.trim() ||
        "Acompanhar o cliente e oferecer horários disponíveis.",
      suggestedFollowupReply:
        input.suggestedFollowupReply.trim() ||
        "Olá! Posso te ajudar a escolher um horário para o seu atendimento?",
      analyzedAt: input.analyzedAt ?? now,
      updatedAt: input.updatedAt ?? now,
    });
  }

  public static restore(
    props: AiConversationInsightProps,
  ): AiConversationInsight {
    return new AiConversationInsight(props);
  }

  public get id(): string {
    return this.props.id;
  }

  public get companyId(): string {
    return this.props.companyId;
  }

  public get conversationId(): string {
    return this.props.conversationId;
  }

  public get leadTemperature(): LeadTemperature {
    return this.props.leadTemperature;
  }

  public get leadScore(): number {
    return this.props.leadScore;
  }

  public get summary(): string {
    return this.props.summary;
  }

  public get detectedObjection(): DetectedObjection {
    return this.props.detectedObjection;
  }

  public get recommendedNextAction(): string {
    return this.props.recommendedNextAction;
  }

  public get suggestedFollowupReply(): string {
    return this.props.suggestedFollowupReply;
  }

  public get analyzedAt(): Date {
    return this.props.analyzedAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public toPersistence(): AiConversationInsightProps {
    return { ...this.props };
  }

  public toDTO(): AiConversationInsightDTO {
    return {
      id: this.props.id,
      companyId: this.props.companyId,
      conversationId: this.props.conversationId,
      leadTemperature: this.props.leadTemperature,
      leadScore: this.props.leadScore,
      summary: this.props.summary,
      detectedObjection: this.props.detectedObjection,
      recommendedNextAction: this.props.recommendedNextAction,
      suggestedFollowupReply: this.props.suggestedFollowupReply,
      analyzedAt: this.props.analyzedAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }
}
