export interface OperationsWhatsAppDispatchInput {
  companyId: string;
  phone: string;
  clientId?: string | null | undefined;
  contactName: string;
  text: string;
  kind:
    | "CASCADE_DELAY"
    | "EMERGENCY_ABSENCE"
    | "WAITLIST_OFFER"
    | "POST_VISIT_SURVEY_PROMPT"
    | "POST_VISIT_SURVEY_REPLY"
    | "CHURN_REACTIVATION";
  metadata?: Record<string, unknown> | undefined;
  recordL0Telemetry?: boolean | undefined;
  now?: Date | undefined;
}

export interface OperationsWhatsAppDispatchResult {
  delivered: boolean;
  provider: string;
  externalMessageId: string | null;
  error?: string | undefined;
}

export interface OperationsNotificationPort {
  sendOperationalMessage(
    input: OperationsWhatsAppDispatchInput,
  ): Promise<OperationsWhatsAppDispatchResult>;
}
