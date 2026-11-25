export interface AiBookingServiceSummary {
  id: string;
  name: string;
  durationMinutes: number;
  priceInCents: number;
}

export interface AiBookingCollaboratorSummary {
  id: string;
  name: string;
  specialty: string | null;
  serviceIds: string[];
}

export interface AiBookingCompanyContext {
  companyId: string;
  companyName: string;
  timezone: string;
  aiSystemPrompt: string | null;
  services: AiBookingServiceSummary[];
  collaborators: AiBookingCollaboratorSummary[];
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
    | "consultar_horarios_livres"
    | "consultar_meus_agendamentos"
    | "criar_agendamento"
    | "reagendar_agendamento"
    | "cancelar_agendamento";
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
    }
  | {
      success: false;
      error: string;
      availableSlots: AiBookingAvailabilitySlot[];
    };

export interface AiBookingToolExecutor {
  listServicesAndProfessionals(): Promise<{
    services: AiBookingServiceSummary[];
    collaborators: AiBookingCollaboratorSummary[];
  }>;

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
  }): Promise<AiBookingCreateAppointmentResult>;

  rescheduleAppointment(input: {
    appointmentId: string;
    startsAt: string; // ISO-8601
    collaboratorId?: string | undefined;
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
}

export interface AiBookingAgentInput {
  company: AiBookingCompanyContext;
  client: {
    id: string | null;
    name: string;
    phone: string;
  };
  history: AiBookingConversationMessage[];
  latestClientMessage: string;
  now: Date;
  tools: AiBookingToolExecutor;
}

export interface AiBookingAgentOutput {
  replyText: string;
  provider: "OPENAI" | "GEMINI" | "SIMULATED";
  actions: AiExecutedToolAction[];
  converted?: boolean | undefined;
}

// Porta de orquestração do agente de IA de agendamento no WhatsApp.
export interface AiBookingAgentPort {
  generateReply(input: AiBookingAgentInput): Promise<AiBookingAgentOutput>;
}
