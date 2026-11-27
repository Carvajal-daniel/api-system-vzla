import crypto from "node:crypto";
import {
  AppointmentNotReschedulableError,
  AppointmentRevertNotAllowedError,
  AppointmentSnapshotValidationError,
} from "../errors/appointment-errors.js";
import {
  AppointmentStatus,
  type AppointmentStatusValue,
  type InitialAppointmentStatusValue,
} from "../value-objects/appointment-status.vo.js";
import { ClientContact } from "../value-objects/client-contact.vo.js";
import { TimeRange } from "../value-objects/time-range.vo.js";

export interface AppointmentProps {
  id: string;
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatusValue;
  cancellationReason: string | null;
  notes?: string | null;
  isGuest?: boolean;
  usesClubBenefit?: boolean;
  serviceNameSnapshot: string;
  servicePriceInCentsSnapshot: number;
  serviceDurationMinutesSnapshot: number;
  commissionPercentageSnapshot: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppointmentInput {
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  clientName: string;
  clientPhone: string;
  startsAt: Date;
  initialStatus?: InitialAppointmentStatusValue;
  notes?: string | undefined;
  serviceNameSnapshot: string;
  servicePriceInCentsSnapshot: number;
  serviceDurationMinutesSnapshot: number;
  commissionPercentageSnapshot: number;
}

export class Appointment {
  private constructor(private props: AppointmentProps) {}

  /**
   * Cria um novo agendamento derivando obrigatoriamente `endsAt` a partir de
   * `startsAt + serviceDurationMinutesSnapshot` e congelando o snapshot histórico do serviço e comissão.
   */
  static create(input: CreateAppointmentInput): Appointment {
    const contact = ClientContact.create(input.clientName, input.clientPhone);

    const normalizedServiceName = input.serviceNameSnapshot.trim();
    if (
      normalizedServiceName.length === 0 ||
      !Number.isInteger(input.serviceDurationMinutesSnapshot) ||
      input.serviceDurationMinutesSnapshot <= 0 ||
      !Number.isInteger(input.servicePriceInCentsSnapshot) ||
      input.servicePriceInCentsSnapshot < 0 ||
      !Number.isFinite(input.commissionPercentageSnapshot) ||
      input.commissionPercentageSnapshot < 0 ||
      input.commissionPercentageSnapshot > 100
    ) {
      throw new AppointmentSnapshotValidationError();
    }

    const derivedEndsAt = new Date(
      input.startsAt.getTime() + input.serviceDurationMinutesSnapshot * 60_000,
    );
    const timeRange = TimeRange.create(input.startsAt, derivedEndsAt);
    const initialStatus = AppointmentStatus.create(input.initialStatus ?? "PENDING");
    const now = new Date();

    return new Appointment({
      id: crypto.randomUUID(),
      companyId: input.companyId,
      collaboratorId: input.collaboratorId,
      serviceId: input.serviceId,
      clientName: contact.name,
      clientPhone: contact.phone,
      startsAt: timeRange.startsAt,
      endsAt: timeRange.endsAt,
      status: initialStatus.value,
      cancellationReason: null,
      notes: input.notes?.trim() || null,
      serviceNameSnapshot: normalizedServiceName,
      servicePriceInCentsSnapshot: input.servicePriceInCentsSnapshot,
      serviceDurationMinutesSnapshot: input.serviceDurationMinutesSnapshot,
      commissionPercentageSnapshot: input.commissionPercentageSnapshot,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: AppointmentProps): Appointment {
    const timeRange = TimeRange.create(props.startsAt, props.endsAt);
    const status = AppointmentStatus.create(props.status);

    return new Appointment({
      ...props,
      startsAt: timeRange.startsAt,
      endsAt: timeRange.endsAt,
      status: status.value,
    });
  }

  transitionStatus(
    nextStatus: AppointmentStatusValue,
    cancellationReason?: string | null,
  ): void {
    const current = AppointmentStatus.create(this.props.status);
    const transitioned = current.transitionTo(nextStatus);

    const normalizedReason =
      nextStatus === "CANCELED"
        ? cancellationReason === undefined || cancellationReason === null
          ? null
          : cancellationReason.trim() || null
        : this.props.cancellationReason;

    this.props = {
      ...this.props,
      status: transitioned.value,
      cancellationReason: normalizedReason,
      updatedAt: new Date(),
    };
  }

  /**
   * Reverte um agendamento concluído (COMPLETED) de volta para CONFIRMED mediante
   * autorização explícita do dono e justificativa registrada em auditoria.
   */
  revertCompletion(): void {
    if (this.props.status !== "COMPLETED") {
      throw new AppointmentRevertNotAllowedError(
        `Cannot revert appointment with status ${this.props.status}.`,
      );
    }

    this.props = {
      ...this.props,
      status: "CONFIRMED",
      updatedAt: new Date(),
    };
  }

  /**
   * Reprograma o agendamento preservando a duração histórica do snapshot e
   * recalculando `endsAt` sempre no backend.
   */
  reschedule(newStartsAt: Date, newCollaboratorId?: string, newCommissionPercentage?: number): void {
    const currentStatus = AppointmentStatus.create(this.props.status);
    if (!currentStatus.isReschedulable()) {
      throw new AppointmentNotReschedulableError(this.props.status);
    }

    const derivedEndsAt = new Date(
      newStartsAt.getTime() + this.props.serviceDurationMinutesSnapshot * 60_000,
    );
    const timeRange = TimeRange.create(newStartsAt, derivedEndsAt);

    this.props = {
      ...this.props,
      collaboratorId: newCollaboratorId ?? this.props.collaboratorId,
      commissionPercentageSnapshot: newCommissionPercentage ?? this.props.commissionPercentageSnapshot,
      startsAt: timeRange.startsAt,
      endsAt: timeRange.endsAt,
      updatedAt: new Date(),
    };
  }

  blocksAvailability(): boolean {
    return AppointmentStatus.create(this.props.status).blocksAvailability();
  }

  toTimeRange(): TimeRange {
    return TimeRange.create(this.props.startsAt, this.props.endsAt);
  }

  get id(): string {
    return this.props.id;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get collaboratorId(): string {
    return this.props.collaboratorId;
  }

  get serviceId(): string {
    return this.props.serviceId;
  }

  get clientName(): string {
    return this.props.clientName;
  }

  get clientPhone(): string {
    return this.props.clientPhone;
  }

  get isGuest(): boolean {
    return this.props.isGuest ?? false;
  }

  get usesClubBenefit(): boolean {
    return this.props.usesClubBenefit ?? false;
  }

  get notes(): string | null {
    return this.props.notes ?? null;
  }

  get startsAt(): Date {
    return this.props.startsAt;
  }

  get endsAt(): Date {
    return this.props.endsAt;
  }

  get status(): AppointmentStatusValue {
    return this.props.status;
  }

  get cancellationReason(): string | null {
    return this.props.cancellationReason;
  }

  get serviceNameSnapshot(): string {
    return this.props.serviceNameSnapshot;
  }

  get servicePriceInCentsSnapshot(): number {
    return this.props.servicePriceInCentsSnapshot;
  }

  get serviceDurationMinutesSnapshot(): number {
    return this.props.serviceDurationMinutesSnapshot;
  }

  get commissionPercentageSnapshot(): number {
    return this.props.commissionPercentageSnapshot;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
