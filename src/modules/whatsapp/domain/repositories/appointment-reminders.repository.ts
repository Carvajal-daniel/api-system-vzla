import type { ReminderTemplateId } from "../../../Company/domain/reminder-templates.js";

export type ReminderWindowType = "24H" | "2H";

export interface PendingReminderSettings {
  enabled: boolean;
  hours: number;
  template: ReminderTemplateId;
  message?: string | null | undefined;
  externalUrl?: string | null | undefined;
}

export interface PendingReminderAppointment {
  appointmentId: string;
  companyId: string;
  companyName: string;
  companySlug?: string | null | undefined;
  companyTimezone: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  collaboratorName: string;
  startsAt: Date;
  reminderSettings?: PendingReminderSettings | null | undefined;
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
