import { randomUUID } from "node:crypto";

export type WhatsAppMessageDirection = "INBOUND" | "OUTBOUND";
export type WhatsAppMessageSenderType = "CLIENT" | "AI_AGENT" | "OWNER";

export interface WhatsAppMessageProps {
  id: string;
  companyId: string;
  conversationId: string;
  externalMessageId: string | null;
  direction: WhatsAppMessageDirection;
  senderType: WhatsAppMessageSenderType;
  content: string;
  metadata: Record<string, unknown>;
  sentAt: Date;
}

export interface WhatsAppMessageDTO {
  id: string;
  companyId: string;
  conversationId: string;
  externalMessageId: string | null;
  direction: WhatsAppMessageDirection;
  senderType: WhatsAppMessageSenderType;
  content: string;
  metadata: Record<string, unknown>;
  sentAt: string;
}

// Entidade de domínio de uma mensagem individual na conversa WhatsApp.
export class WhatsAppMessage {
  private readonly props: WhatsAppMessageProps;

  private constructor(props: WhatsAppMessageProps) {
    this.props = props;
  }

  public static create(input: {
    companyId: string;
    conversationId: string;
    externalMessageId?: string | null;
    direction: WhatsAppMessageDirection;
    senderType: WhatsAppMessageSenderType;
    content: string;
    metadata?: Record<string, unknown>;
    sentAt?: Date;
  }): WhatsAppMessage {
    return new WhatsAppMessage({
      id: randomUUID(),
      companyId: input.companyId,
      conversationId: input.conversationId,
      externalMessageId: input.externalMessageId?.trim() || null,
      direction: input.direction,
      senderType: input.senderType,
      content: input.content.trim(),
      metadata: input.metadata ? { ...input.metadata } : {},
      sentAt: input.sentAt ?? new Date(),
    });
  }

  public static restore(props: WhatsAppMessageProps): WhatsAppMessage {
    return new WhatsAppMessage(props);
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

  public get externalMessageId(): string | null {
    return this.props.externalMessageId;
  }

  public get direction(): WhatsAppMessageDirection {
    return this.props.direction;
  }

  public get senderType(): WhatsAppMessageSenderType {
    return this.props.senderType;
  }

  public get content(): string {
    return this.props.content;
  }

  public get metadata(): Record<string, unknown> {
    return { ...this.props.metadata };
  }

  public get sentAt(): Date {
    return this.props.sentAt;
  }

  public toPersistence(): WhatsAppMessageProps {
    return {
      ...this.props,
      metadata: { ...this.props.metadata },
    };
  }

  public toDTO(): WhatsAppMessageDTO {
    return {
      id: this.props.id,
      companyId: this.props.companyId,
      conversationId: this.props.conversationId,
      externalMessageId: this.props.externalMessageId,
      direction: this.props.direction,
      senderType: this.props.senderType,
      content: this.props.content,
      metadata: { ...this.props.metadata },
      sentAt: this.props.sentAt.toISOString(),
    };
  }
}
