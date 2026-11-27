import type { ActorContext } from "../../../shared/auth/actor-context.js";
import {
  buildChurnReactivationMessage,
  computeIndividualChurnRadar,
  DEFAULT_CHURN_MARGIN_DAYS,
  OperationsDomainError,
  type ClientVisitHistory,
  type IndividualChurnCandidate,
} from "../domain/operations-rules.js";
import type { OperationsNotificationPort } from "./ports/operations-notification.port.js";

export interface ChurnRadarRepositoryPort {
  getCompanyName(companyId: string): Promise<string | null>;
  listCompletedVisitHistories(companyId: string): Promise<ClientVisitHistory[]>;
}

// Radar de Churn Individual: calcula o ciclo real de retorno por cliente (mínimo 2 visitas)
// e permite disparar convite personalizado via WhatsApp sem gastar tokens L2.
export class ChurnRadarUseCase {
  constructor(
    private readonly repository: ChurnRadarRepositoryPort,
    private readonly notificationPort: OperationsNotificationPort,
  ) {}

  async getRadar(input: {
    actor: ActorContext;
    marginDays?: number | undefined;
    now?: Date | undefined;
  }): Promise<{
    marginDays: number;
    generatedAt: string;
    totalAtRisk: number;
    highRiskCount: number;
    warningCount: number;
    clients: IndividualChurnCandidate[];
  }> {
    if (input.actor.role !== "OWNER") {
      throw new OperationsDomainError(
        "Only company owners can access the churn radar.",
        "FORBIDDEN",
        "OWNER_REQUIRED",
      );
    }

    const now = input.now ?? new Date();
    const marginDays = input.marginDays ?? DEFAULT_CHURN_MARGIN_DAYS;
    const histories = await this.repository.listCompletedVisitHistories(
      input.actor.companyId,
    );
    const clients = computeIndividualChurnRadar(histories, now, marginDays);

    return {
      marginDays,
      generatedAt: now.toISOString(),
      totalAtRisk: clients.length,
      highRiskCount: clients.filter((c) => c.risk === "HIGH_RISK").length,
      warningCount: clients.filter((c) => c.risk === "WARNING").length,
      clients,
    };
  }

  async sendReactivationInvite(input: {
    actor: ActorContext;
    clientId: string;
    customMessage?: string | undefined;
    marginDays?: number | undefined;
    now?: Date | undefined;
  }): Promise<{
    clientId: string;
    delivered: boolean;
    message: string;
    candidate: IndividualChurnCandidate;
  }> {
    if (input.actor.role !== "OWNER") {
      throw new OperationsDomainError(
        "Only company owners can dispatch reactivation invites.",
        "FORBIDDEN",
        "OWNER_REQUIRED",
      );
    }

    const now = input.now ?? new Date();
    const histories = await this.repository.listCompletedVisitHistories(
      input.actor.companyId,
    );
    const candidates = computeIndividualChurnRadar(
      histories,
      now,
      input.marginDays ?? DEFAULT_CHURN_MARGIN_DAYS,
    );
    const candidate = candidates.find((item) => item.clientId === input.clientId);

    if (!candidate) {
      throw new OperationsDomainError(
        "Client is not currently flagged in the individual churn radar.",
        "NOT_FOUND",
        "CHURN_CANDIDATE_NOT_FOUND",
      );
    }

    const companyName =
      (await this.repository.getCompanyName(input.actor.companyId)) ?? "nossa barbearia";

    const message =
      input.customMessage?.trim() ||
      buildChurnReactivationMessage({
        clientName: candidate.clientName,
        companyName,
        lastServiceName: candidate.lastServiceName,
        averageCycleDays: candidate.averageCycleDays,
      });

    const dispatch = await this.notificationPort.sendOperationalMessage({
      companyId: input.actor.companyId,
      phone: candidate.clientPhone,
      clientId: candidate.clientId,
      contactName: candidate.clientName,
      text: message,
      kind: "CHURN_REACTIVATION",
      metadata: {
        clientId: candidate.clientId,
        averageCycleDays: candidate.averageCycleDays,
        overdueDays: candidate.overdueDays,
        risk: candidate.risk,
      },
      recordL0Telemetry: true,
      now,
    });

    return {
      clientId: candidate.clientId,
      delivered: dispatch.delivered,
      message,
      candidate,
    };
  }
}
