import type { AppointmentPolicyConflict } from "../../../appointments/domain/services/appointment-policy.service.js";

export interface AiBookingServiceSummary {
  id: string;
  name: string;
  description?: string | null | undefined;
  category?: string | undefined;
  durationMinutes: number;
  priceInCents: number;
}

export interface AiBookingServiceCategoryGroup {
  category: string;
  services: AiBookingServiceSummary[];
}

export interface AiBookingSubscriptionPlanItem {
  id?: string | undefined;
  name: string;
  description?: string | null | undefined;
  priceInCents?: number | null | undefined;
  durationMinutes?: number | null | undefined;
  allowedDaysOfWeek?: number[] | null | undefined;
  billingCycle?: "MONTHLY" | undefined;
  includedServiceIds?: string[] | undefined;
  includedServiceNames?: string[] | undefined;
  maxMonthlyUses?: number | null | undefined;
}

export interface AiBookingSubscriptionPlansResult {
  enabled: boolean;
  notes: string | null;
  plans: AiBookingSubscriptionPlanItem[];
}

export interface AiBookingCollaboratorSummary {
  id: string;
  name: string;
  specialty: string | null;
  serviceIds: string[];
}

export interface AiBookingOperationalRules {
  address?: string | null;
  googleMapsUrl?: string | null;
  paymentMethods?: string | null;
  delayPolicy?: string | null;
  packageNotes?: string | null;
}

export interface AiBookingCustomerSubscription {
  subscriptionId: string;
  planId: string;
  planName: string;
  status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
  includedServiceIds: string[];
  includedServiceNames: string[];
  allowedDaysOfWeek: number[] | null;
  maxMonthlyUses: number | null;
  remainingUses: number | null;
  currentPeriodEnd: string | null;
  daysUntilRenewal: number | null;
  inGracePeriod: boolean;
  needsRenewalAlert: boolean;
}

export interface AiBookingCustomerContext {
  isNewCustomer?: boolean;
  totalVisits?: number;
  registeredName: string | null;
  isSubscriber?: boolean;
  subscription?: AiBookingCustomerSubscription | null;
  mostFrequentServiceName?: string | null;
  lastCompletedVisit?: {
    localDate: string;
    serviceName: string;
    collaboratorName: string;
  } | null;
  preferredCollaboratorName?: string | null;
  habitualWeekday?: string | null;
  activePackagesOrTags?: string[];
  todayAppointments?: AiBookingCustomerAppointment[];
}

export interface AiBookingCompanyContext {
  companyId: string;
  companyName: string;
  timezone: string;
  aiSystemPrompt: string | null;
  services: AiBookingServiceSummary[];
  collaborators: AiBookingCollaboratorSummary[];
  operationalRules?: AiBookingOperationalRules;
  depositPolicy?: {
    enabled: boolean;
    depositPercentage: number;
    hasActivePaymentProvider: boolean;
  };
  customerContext?: AiBookingCustomerContext;
}

export interface AiBookingConversationMessage {
  direction: "INBOUND" | "OUTBOUND";
  senderType: "CLIENT" | "AI_AGENT" | "OWNER";
  content: string;
  sentAt: string;
}

export interface AiExecutedToolAction {
  tool:
    | "listar_servicos_e_profissionais"
    | "consultar_planos_assinatura"
    | "consultar_horarios_livres"
    | "consultar_meus_agendamentos"
    | "criar_agendamento"
    | "reagendar_agendamento"
    | "cancelar_agendamento"
    | "gerar_pagamento_clube"
    | "verificar_status_pagamento"
    | "request_human_handoff";
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
  data?: unknown;
}

export interface AiBookingCustomerAppointment {
  appointmentId: string;
  serviceName: string;
  collaboratorName: string;
  localDate: string;
  localTime: string;
  startsAt: string;
  status: string;
}

export interface AiBookingAvailabilitySlot {
  startsAt: string;
  endsAt: string;
  localDate?: string;
  localTime?: string;
  collaboratorId: string;
  collaboratorName: string;
}

export interface AiBookingPaymentLinkInfo {
  paymentId: string | null;
  amountCents: number;
  status: string;
  pixCopyPaste: string | null;
  checkoutUrl: string | null;
  expiresAt: string | null;
}

export type AiBookingCreateAppointmentResult =
  | {
      success?: true;
      id: string;
      startsAt: string;
      endsAt: string;
      localDate?: string;
      localTime?: string;
      status: string;
      serviceName: string;
      collaboratorId: string;
      servicePriceInCents?: number;
      coveredByClub?: boolean;
      requiresDeposit?: boolean;
      depositAmountCents?: number;
      payment?: AiBookingPaymentLinkInfo | null;
    }
  | {
      success: false;
      error: string;
      availableSlots: AiBookingAvailabilitySlot[];
      code?: string | undefined;
      currentAppointment?: AppointmentPolicyConflict | undefined;
    };

export interface AiBookingToolExecutor {
  listServicesAndProfessionals(): Promise<{
    services: AiBookingServiceSummary[];
    servicesByCategory?: AiBookingServiceCategoryGroup[] | undefined;
    collaborators: AiBookingCollaboratorSummary[];
    subscriptionPlans?: AiBookingSubscriptionPlansResult | undefined;
  }>;

  listSubscriptionPlans?(): Promise<AiBookingSubscriptionPlansResult>;

  checkAvailability(input: {
    serviceId: string;
    date: string; // YYYY-MM-DD
    collaboratorId?: string | undefined;
  }): Promise<{
    date: string;
    timezone: string;
    serviceDurationMinutes: number;
    slots: AiBookingAvailabilitySlot[];
  }>;

  listCustomerUpcomingAppointments(): Promise<{
    appointments: AiBookingCustomerAppointment[];
  }>;

  createAppointment(input: {
    serviceId: string;
    collaboratorId: string;
    startsAt: string; // ISO-8601
    localDate?: string | undefined; // YYYY-MM-DD no fuso da empresa
    localTime?: string | undefined; // HH:MM no fuso da empresa
    clientName?: string | undefined;
    notes?: string | undefined;
    isGuest?: boolean | undefined;
    payFullPrice?: boolean | undefined;
    document?: string | undefined;
  }): Promise<AiBookingCreateAppointmentResult>;

  createClubPayment?(input: {
    action: "SUBSCRIBE" | "RENEW";
    planId?: string | undefined;
    paymentMethod: "PIX" | "CREDIT_CARD";
    document?: string | undefined;
  }): Promise<{
    ok: boolean;
    subscriptionId?: string | undefined;
    payment?: AiBookingPaymentLinkInfo | null | undefined;
    message: string;
    code?: string | undefined;
  }>;

  checkPaymentStatus?(input: {
    paymentId: string;
  }): Promise<{
    paymentId: string;
    status: string;
    paidAt: string | null;
    expiresAt: string | null;
  }>;

  rescheduleAppointment(input: {
    appointmentId: string;
    startsAt: string; // ISO-8601
    collaboratorId?: string | undefined;
    payFullPrice?: boolean | undefined;
  }): Promise<{
    id: string;
    startsAt: string;
    endsAt: string;
    localDate?: string;
    localTime?: string;
    status: string;
    collaboratorId: string;
  }>;

  cancelAppointment(input: {
    appointmentId: string;
    cancellationReason?: string | undefined;
  }): Promise<{
    id: string;
    status: string;
  }>;

  requestHumanHandoff?(input: {
    reason?: string | undefined;
  }): Promise<{
    handoff: true;
    reason: string;
  }>;
}

export interface AiBookingAgentInput {
  company: AiBookingCompanyContext;
  client: {
    id: string | null;
    name: string | null;
    phone: string;
  };
  history: AiBookingConversationMessage[];
  latestClientMessage: string;
  now: Date;
  tools: AiBookingToolExecutor;
}

export interface AiBookingTokenUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AiBookingAgentOutput {
  replyText: string;
  provider: "OPENAI" | "GEMINI" | "SIMULATED" | "UNAVAILABLE";
  actions: AiExecutedToolAction[];
  converted?: boolean | undefined;
  handoffRequested?: { reason: string } | undefined;
  usage?: AiBookingTokenUsage | undefined;
}

// Porta de orquestração do agente de IA de agendamento no WhatsApp.
export interface AiBookingAgentPort {
  generateReply(input: AiBookingAgentInput): Promise<AiBookingAgentOutput>;
}
