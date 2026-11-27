import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { getLocalDateTimeParts } from "../../appointments/domain/services/timezone-utils.js";
import {
  buildWaitlistOfferMessage,
  isShiftCompatible,
  OperationsDomainError,
  WAITLIST_OFFER_WINDOW_MINUTES,
} from "../domain/operations-rules.js";
import type {
  WaitlistShift,
  WaitlistStatus,
} from "../infra/database/schema/operations-schema.js";
import type { OperationsNotificationPort } from "./ports/operations-notification.port.js";

export interface WaitlistEntryRecord {
  id: string;
  companyId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  collaboratorId: string | null;
  collaboratorName: string | null;
  desiredDate: string;
  preferredShift: WaitlistShift;
  status: WaitlistStatus;
  notifiedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface WaitlistRepositoryPort {
  getCompanyContext(companyId: string): Promise<{
    companyName: string;
    timezone: string;
  } | null>;
  clientExistsInCompany(companyId: string, clientId: string): Promise<boolean>;
  collaboratorExistsInCompany(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ id: string; name: string } | null>;
  createEntry(params: {
    companyId: string;
    clientId: string;
    collaboratorId: string | null;
    desiredDate: string;
    preferredShift: WaitlistShift;
  }): Promise<WaitlistEntryRecord>;
  listEntries(params: {
    companyId: string;
    date: string;
    status?: WaitlistStatus | undefined;
  }): Promise<WaitlistEntryRecord[]>;
  findWaitingCandidatesForDate(params: {
    companyId: string;
    desiredDate: string;
    collaboratorId: string | null;
  }): Promise<WaitlistEntryRecord[]>;
  markEntryNotified(params: {
    companyId: string;
    entryId: string;
    notifiedAt: Date;
    expiresAt: Date;
  }): Promise<WaitlistEntryRecord | null>;
  expireStaleNotifiedEntries(now: Date): Promise<WaitlistEntryRecord[]>;
}

export interface AddWaitlistEntryInput {
  actor: ActorContext;
  clientId: string;
  collaboratorId?: string | null | undefined;
  desiredDate: string;
  preferredShift?: WaitlistShift | undefined;
}

export interface AddPublicWaitlistEntryInput {
  companyId: string;
  clientId: string;
  collaboratorId?: string | null | undefined;
  desiredDate: string;
  preferredShift?: WaitlistShift | undefined;
}

export interface NotifyWaitlistForCanceledSlotInput {
  companyId: string;
  collaboratorId: string;
  collaboratorName?: string | undefined;
  startsAt: Date;
  now?: Date | undefined;
}

// Gerencia a Fila de Espera Inteligente: cadastro, listagem diária, oferta automática ao cancelar
// e expiração em 20 minutos com repasse para o próximo cliente compatível.
export class WaitlistUseCase {
  constructor(
    private readonly repository: WaitlistRepositoryPort,
    private readonly notificationPort: OperationsNotificationPort,
  ) {}

  async addEntry(input: AddWaitlistEntryInput): Promise<WaitlistEntryRecord> {
    if (input.actor.role !== "OWNER") {
      throw new OperationsDomainError(
        "Only company owners can manage the waitlist.",
        "FORBIDDEN",
        "OWNER_REQUIRED",
      );
    }

    return this.createValidatedEntry({
      companyId: input.actor.companyId,
      clientId: input.clientId,
      collaboratorId: input.collaboratorId,
      desiredDate: input.desiredDate,
      preferredShift: input.preferredShift,
    });
  }

  // Entrada pública na Fila de Espera Inteligente a partir do portal por slug (sem JWT de OWNER).
  async addPublicEntry(input: AddPublicWaitlistEntryInput): Promise<WaitlistEntryRecord> {
    return this.createValidatedEntry(input);
  }

  private async createValidatedEntry(input: AddPublicWaitlistEntryInput): Promise<WaitlistEntryRecord> {
    const clientExists = await this.repository.clientExistsInCompany(
      input.companyId,
      input.clientId,
    );
    if (!clientExists) {
      throw new OperationsDomainError("Client not found in this company.", "NOT_FOUND", "CLIENT_NOT_FOUND");
    }

    const collaboratorId = input.collaboratorId ?? null;
    if (collaboratorId) {
      const collaborator = await this.repository.collaboratorExistsInCompany(
        input.companyId,
        collaboratorId,
      );
      if (!collaborator) {
        throw new OperationsDomainError(
          "Collaborator not found in this company.",
          "NOT_FOUND",
          "COLLABORATOR_NOT_FOUND",
        );
      }
    }

    return this.repository.createEntry({
      companyId: input.companyId,
      clientId: input.clientId,
      collaboratorId,
      desiredDate: input.desiredDate,
      preferredShift: input.preferredShift ?? "ANY",
    });
  }

  async listDayEntries(input: {
    actor: ActorContext;
    date?: string | undefined;
    status?: WaitlistStatus | undefined;
    now?: Date | undefined;
  }): Promise<{ date: string; entries: WaitlistEntryRecord[] }> {
    if (input.actor.role !== "OWNER") {
      throw new OperationsDomainError(
        "Only company owners can view the waitlist.",
        "FORBIDDEN",
        "OWNER_REQUIRED",
      );
    }

    const company = await this.repository.getCompanyContext(input.actor.companyId);
    const targetDate =
      input.date ??
      getLocalDateTimeParts(
        input.now ?? new Date(),
        company?.timezone ?? "America/Sao_Paulo",
      ).dateString;

    const entries = await this.repository.listEntries({
      companyId: input.actor.companyId,
      date: targetDate,
      status: input.status,
    });

    return { date: targetDate, entries };
  }

  async notifyNextCompatibleForCanceledAppointment(
    input: NotifyWaitlistForCanceledSlotInput,
  ): Promise<{
    notifiedEntry: WaitlistEntryRecord | null;
    delivered: boolean;
  }> {
    const now = input.now ?? new Date();
    const company = await this.repository.getCompanyContext(input.companyId);
    if (!company) {
      return { notifiedEntry: null, delivered: false };
    }

    const localParts = getLocalDateTimeParts(input.startsAt, company.timezone);
    const candidates = await this.repository.findWaitingCandidatesForDate({
      companyId: input.companyId,
      desiredDate: localParts.dateString,
      collaboratorId: input.collaboratorId,
    });

    const matched = candidates.find(
      (entry) =>
        (entry.collaboratorId === null ||
          entry.collaboratorId === input.collaboratorId) &&
        isShiftCompatible(entry.preferredShift, localParts.hour),
    );

    if (!matched) {
      return { notifiedEntry: null, delivered: false };
    }

    const expiresAt = new Date(
      now.getTime() + WAITLIST_OFFER_WINDOW_MINUTES * 60 * 1000,
    );
    const claimed = await this.repository.markEntryNotified({
      companyId: input.companyId,
      entryId: matched.id,
      notifiedAt: now,
      expiresAt,
    });

    if (!claimed) {
      return { notifiedEntry: null, delivered: false };
    }

    let collaboratorName = input.collaboratorName ?? matched.collaboratorName ?? null;
    if (!collaboratorName) {
      const collab = await this.repository.collaboratorExistsInCompany(
        input.companyId,
        input.collaboratorId,
      );
      collaboratorName = collab?.name ?? "nosso profissional";
    }

    const text = buildWaitlistOfferMessage({
      clientName: claimed.clientName,
      companyName: company.companyName,
      slotStartsAt: input.startsAt,
      collaboratorName,
      timezone: company.timezone,
    });

    const dispatch = await this.notificationPort.sendOperationalMessage({
      companyId: input.companyId,
      phone: claimed.clientPhone,
      clientId: claimed.clientId,
      contactName: claimed.clientName,
      text,
      kind: "WAITLIST_OFFER",
      metadata: {
        waitlistEntryId: claimed.id,
        desiredDate: claimed.desiredDate,
        slotStartsAt: input.startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      recordL0Telemetry: true,
      now,
    });

    return {
      notifiedEntry: claimed,
      delivered: dispatch.delivered,
    };
  }

  // Expira ofertas cuja janela de 20 minutos venceu e aciona automaticamente o próximo cliente compatível.
  async expireStaleOffersAndNotifyNext(now: Date = new Date()): Promise<{
    expiredCount: number;
    reofferedCount: number;
  }> {
    const expiredEntries = await this.repository.expireStaleNotifiedEntries(now);
    let reofferedCount = 0;

    for (const expired of expiredEntries) {
      const company = await this.repository.getCompanyContext(expired.companyId);
      if (!company) continue;

      const candidates = await this.repository.findWaitingCandidatesForDate({
        companyId: expired.companyId,
        desiredDate: expired.desiredDate,
        collaboratorId: expired.collaboratorId,
      });

      const next = candidates.find(
        (entry) =>
          entry.preferredShift === "ANY" ||
          expired.preferredShift === "ANY" ||
          entry.preferredShift === expired.preferredShift,
      );

      if (!next) continue;

      const expiresAt = new Date(
        now.getTime() + WAITLIST_OFFER_WINDOW_MINUTES * 60 * 1000,
      );
      const claimed = await this.repository.markEntryNotified({
        companyId: expired.companyId,
        entryId: next.id,
        notifiedAt: now,
        expiresAt,
      });

      if (!claimed) continue;

      const text = `Olá, ${claimed.clientName}! Uma vaga na ${company.companyName} para o dia ${claimed.desiredDate} foi liberada na nossa fila de espera. Você tem prioridade pelos próximos 20 minutos — responda *SIM* para garantir seu encaixe!`;

      await this.notificationPort.sendOperationalMessage({
        companyId: expired.companyId,
        phone: claimed.clientPhone,
        clientId: claimed.clientId,
        contactName: claimed.clientName,
        text,
        kind: "WAITLIST_OFFER",
        metadata: {
          waitlistEntryId: claimed.id,
          reofferedFromEntryId: expired.id,
          desiredDate: claimed.desiredDate,
          expiresAt: expiresAt.toISOString(),
        },
        recordL0Telemetry: true,
        now,
      });

      reofferedCount += 1;
    }

    return {
      expiredCount: expiredEntries.length,
      reofferedCount,
    };
  }
}
