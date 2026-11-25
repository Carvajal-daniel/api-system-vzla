export interface EligibleNpsAppointment {
  appointmentId: string;
  companyId: string;
  companyName: string;
  googleMapsUrl: string | null;
  collaboratorId: string;
  collaboratorName: string;
  serviceName: string;
  clientName: string;
  clientPhone: string;
  completedAt: Date;
}

export interface PendingNpsAppointment {
  appointmentId: string;
  companyId: string;
  companyName: string;
  googleMapsUrl: string | null;
  collaboratorId: string;
  collaboratorName: string;
  serviceName: string;
  clientName: string;
  clientPhone: string;
  npsSentAt: Date;
}

// Porta de persistência do ciclo pós-atendimento (NPS 1 a 5), garantindo isolamento por companyId.
export interface PostVisitNpsRepository {
  findCompletedEligibleForNps(params: {
    tenantId?: string | undefined;
    now: Date;
  }): Promise<EligibleNpsAppointment[]>;

  markNpsSent(params: {
    companyId: string;
    appointmentId: string;
    sentAt: Date;
  }): Promise<boolean>;

  findPendingNpsForPhone(params: {
    companyId: string;
    phone: string;
    now: Date;
  }): Promise<PendingNpsAppointment | null>;

  recordNpsResponse(params: {
    companyId: string;
    appointmentId: string;
    collaboratorId: string;
    clientId: string | null;
    clientName: string;
    serviceName: string;
    rating: number;
    comment: string | null;
    respondedAt: Date;
  }): Promise<boolean>;
}
