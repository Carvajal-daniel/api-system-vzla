export type ReminderWindowType = "24H" | "2H";

export interface PendingReminderAppointment {
  appointmentId: string;
  companyId: string;
  companyName: string;
  companyTimezone: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  collaboratorName: string;
  startsAt: Date;
}

// Porta de consulta e marcação idempotente de lembretes de agendamento (24h e 2h), isolada por companyId.
export interface AppointmentRemindersRepository {
  findPendingReminders(params: {
    tenantId?: string | undefined;
    now: Date;
    windowType: ReminderWindowType;
  }): Promise<PendingReminderAppointment[]>;

  markReminderSent(params: {
    companyId: string;
    appointmentId: string;
    windowType: ReminderWindowType;
    sentAt: Date;
  }): Promise<boolean>;
}
