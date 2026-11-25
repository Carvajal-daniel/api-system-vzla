import { randomUUID } from "node:crypto";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";

export type WhatsAppConversationStatus =
  | "OPEN"
  | "WAITING_CLIENT"
  | "CONVERTED"
  | "ARCHIVED";

export type WhatsAppAssignedMode = "AI_AUTOPILOT" | "HUMAN";

export interface WhatsAppConversationProps {
  id: string;
  companyId: string;
  clientId: string | null;
  phone: string;
  contactName: string | null;
  status: WhatsAppConversationStatus;
  assignedMode: WhatsAppAssignedMode;
  unreadCount: number;
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsAppConversationDTO {
  id: string;
  companyId: string;
  clientId: string | null;
  phone: string;
  contactName: string | null;
  status: WhatsAppConversationStatus;
  assignedMode: WhatsAppAssignedMode;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview?: string | null;
}

// Entidade de domínio que representa uma conversa de WhatsApp 1-a-1 isolada por companyId.
export class WhatsAppConversation {
  private readonly props: WhatsAppConversationProps;

  private constructor(props: WhatsAppConversationProps) {
    this.props = props;
  }

  public static create(input: {
    companyId: string;
    phone: string;
    clientId?: string | null;
    contactName?: string | null;
    assignedMode?: WhatsAppAssignedMode;
    status?: WhatsAppConversationStatus;
    unreadCount?: number;
    now?: Date;
  }): WhatsAppConversation {
    const normalizedPhone = Phone.create(input.phone).value;
    const now = input.now ?? new Date();
    return new WhatsAppConversation({
      id: randomUUID(),
      companyId: input.companyId,
      clientId: input.clientId ?? null,
      phone: normalizedPhone,
      contactName: input.contactName?.trim() || null,
      status: input.status ?? "OPEN",
      assignedMode: input.assignedMode ?? "AI_AUTOPILOT",
      unreadCount: Math.max(0, input.unreadCount ?? 0),
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static restore(props: WhatsAppConversationProps): WhatsAppConversation {
    return new WhatsAppConversation(props);
  }

  public get id(): string {
    return this.props.id;
  }

  public get companyId(): string {
    return this.props.companyId;
  }

  public get clientId(): string | null {
    return this.props.clientId;
  }

  public get phone(): string {
    return this.props.phone;
  }

  public get contactName(): string | null {
    return this.props.contactName;
  }

  public get status(): WhatsAppConversationStatus {
    return this.props.status;
  }

  public get assignedMode(): WhatsAppAssignedMode {
    return this.props.assignedMode;
  }

  public get unreadCount(): number {
    return this.props.unreadCount;
  }

  public get lastMessageAt(): Date {
    return this.props.lastMessageAt;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public toPersistence(): WhatsAppConversationProps {
    return { ...this.props };
  }

  public toDTO(lastMessagePreview?: string | null): WhatsAppConversationDTO {
    return {
      id: this.props.id,
      companyId: this.props.companyId,
      clientId: this.props.clientId,
      phone: this.props.phone,
      contactName: this.props.contactName,
      status: this.props.status,
      assignedMode: this.props.assignedMode,
      unreadCount: this.props.unreadCount,
      lastMessageAt: this.props.lastMessageAt.toISOString(),
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
      ...(lastMessagePreview !== undefined ? { lastMessagePreview } : {}),
    };
  }
}
