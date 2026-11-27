import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { getLocalDayUtcBounds } from "../../appointments/domain/services/timezone-utils.js";
import { buildEmergencyAbsenceMessage, OperationsDomainError } from "../domain/operations-rules.js";
import type { OperationsNotificationPort } from "./ports/operations-notification.port.js";

export interface EmergencyAffectedAppointment {
  id: string;
  serviceId: string;
  serviceName: string;
  clientName: string;
  clientPhone: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export interface EmergencyAlternativeSlot {
  collaboratorId: string;
  collaboratorName: string;
  startsAt: Date;
  endsAt: Date;
}

export interface EmergencyAbsenceRepositoryPort {
  findCompanyAndCollaborator(
    companyId: string,
    collaboratorId: string,
  ): Promise<{
    timezone: string;
    collaboratorName: string;
  } | null>;
  createDayScheduleBlock(params: {
    companyId: string;
    collaboratorId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
  }): Promise<{ id: string }>;
  findActiveAppointmentsForCollaboratorInRange(params: {
    companyId: string;
    collaboratorId: string;
    startUtc: Date;
    endUtc: Date;
  }): Promise<EmergencyAffectedAppointment[]>;
  findCompatibleAlternativeSlot(params: {
    companyId: string;
    excludeCollaboratorId: string;
    serviceId: string;
    date: string;
    targetStartsAt: Date;
  }): Promise<EmergencyAlternativeSlot | null>;
  createOwnerAlert(params: {
    companyId: string;
    type: "COLLABORATOR_EMERGENCY";
    title: string;
    description: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string }>;
}

export interface EmergencyAbsenceInput {
  actor: ActorContext;
  collaboratorId: string;
  date: string;
  reason?: string | undefined;
  now?: Date | undefined;
}

export interface EmergencyAbsenceOutput {
  blockId: string;
  ownerAlertId: string;
  collaboratorId: string;
  date: string;
  affectedCount: number;
  notifiedCount: number;
  affectedAppointments: Array<{
    appointmentId: string;
    clientName: string;
    originalStartsAt: string;
    suggestedAlternative: {
      collaboratorId: string;
      collaboratorName: string;
      startsAt: string;
    } | null;
    notified: boolean;
  }>;
}

// Modo Imprevisto: bloqueia a agenda do dia, busca encaixes em outros barbeiros da mesma loja,
// aciona os clientes afetados pelo WhatsApp e gera alerta operacional ao dono.
export class EmergencyAbsenceUseCase {
  constructor(
    private readonly repository: EmergencyAbsenceRepositoryPort,
    private readonly notificationPort: OperationsNotificationPort,
  ) {}

  async execute(input: EmergencyAbsenceInput): Promise<EmergencyAbsenceOutput> {
    if (input.actor.role !== "OWNER") {
      throw new OperationsDomainError(
        "Only company owners can trigger emergency absence mode.",
        "FORBIDDEN",
        "OWNER_REQUIRED",
      );
    }

    const context = await this.repository.findCompanyAndCollaborator(
      input.actor.companyId,
      input.collaboratorId,
    );
    if (!context) {
      throw new OperationsDomainError(
        "Collaborator not found in this company.",
        "NOT_FOUND",
        "COLLABORATOR_NOT_FOUND",
      );
    }

    const now = input.now ?? new Date();
    const { startUtc, endUtc } = getLocalDayUtcBounds(input.date, context.timezone);
    const reason = input.reason?.trim() || "Ausência emergencial registrada pelo balcão";

    const block = await this.repository.createDayScheduleBlock({
      companyId: input.actor.companyId,
      collaboratorId: input.collaboratorId,
      startsAt: startUtc,
      endsAt: endUtc,
      reason,
    });

    const affected =
      await this.repository.findActiveAppointmentsForCollaboratorInRange({
        companyId: input.actor.companyId,
        collaboratorId: input.collaboratorId,
        startUtc,
        endUtc,
      });

    let notifiedCount = 0;
    const summaryItems: EmergencyAbsenceOutput["affectedAppointments"] = [];

    for (const appt of affected) {
      const alternative = await this.repository.findCompatibleAlternativeSlot({
        companyId: input.actor.companyId,
        excludeCollaboratorId: input.collaboratorId,
        serviceId: appt.serviceId,
        date: input.date,
        targetStartsAt: appt.startsAt,
      });

      const text = buildEmergencyAbsenceMessage({
        clientName: appt.clientName,
        absentCollaboratorName: context.collaboratorName,
        originalStartsAt: appt.startsAt,
        timezone: context.timezone,
        alternative: alternative
          ? {
              collaboratorName: alternative.collaboratorName,
              startsAt: alternative.startsAt,
            }
          : null,
      });

      const dispatch = await this.notificationPort.sendOperationalMessage({
        companyId: input.actor.companyId,
        phone: appt.clientPhone,
        contactName: appt.clientName,
        text,
        kind: "EMERGENCY_ABSENCE",
        metadata: {
          blockId: block.id,
          appointmentId: appt.id,
          absentCollaboratorId: input.collaboratorId,
          alternativeCollaboratorId: alternative?.collaboratorId ?? null,
          alternativeStartsAt: alternative?.startsAt.toISOString() ?? null,
        },
        recordL0Telemetry: true,
        now,
      });

      if (dispatch.delivered) {
        notifiedCount += 1;
      }

      summaryItems.push({
        appointmentId: appt.id,
        clientName: appt.clientName,
        originalStartsAt: appt.startsAt.toISOString(),
        suggestedAlternative: alternative
          ? {
              collaboratorId: alternative.collaboratorId,
              collaboratorName: alternative.collaboratorName,
              startsAt: alternative.startsAt.toISOString(),
            }
          : null,
        notified: dispatch.delivered,
      });
    }

    const withAlternativeCount = summaryItems.filter(
      (item) => item.suggestedAlternative !== null,
    ).length;

    const ownerAlert = await this.repository.createOwnerAlert({
      companyId: input.actor.companyId,
      type: "COLLABORATOR_EMERGENCY",
      title: `Modo Imprevisto ativado: ${context.collaboratorName} (${input.date})`,
      description:
        affected.length > 0
          ? `${affected.length} agendamento(s) afetado(s); ${withAlternativeCount} com opção de encaixe imediato em outro profissional e ${notifiedCount} cliente(s) notificado(s) via WhatsApp.`
          : `Agenda bloqueada para ${context.collaboratorName} em ${input.date} sem agendamentos ativos impactados.`,
      metadata: {
        blockId: block.id,
        collaboratorId: input.collaboratorId,
        collaboratorName: context.collaboratorName,
        date: input.date,
        reason,
        affectedCount: affected.length,
        withAlternativeCount,
        notifiedCount,
        affectedAppointmentIds: affected.map((item) => item.id),
      },
    });

    return {
      blockId: block.id,
      ownerAlertId: ownerAlert.id,
      collaboratorId: input.collaboratorId,
      date: input.date,
      affectedCount: affected.length,
      notifiedCount,
      affectedAppointments: summaryItems,
    };
  }
}
