import { randomUUID } from "node:crypto";
import { InvalidCommissionPercentageError } from "../errors/service-errors.js";

export interface CollaboratorServiceProps {
  id: string;
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  commissionPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollaboratorServiceProps {
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  commissionPercentage: number;
}

export class CollaboratorServiceEntity {
  private constructor(private readonly props: CollaboratorServiceProps) {}

  private static validateCommission(value: number): number {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new InvalidCommissionPercentageError();
    }

    const scaled = value * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
      throw new InvalidCommissionPercentageError();
    }

    return Math.round(scaled) / 100;
  }

  static create(input: CreateCollaboratorServiceProps): CollaboratorServiceEntity {
    const commissionPercentage = CollaboratorServiceEntity.validateCommission(
      input.commissionPercentage,
    );
    const now = new Date();

    return new CollaboratorServiceEntity({
      id: randomUUID(),
      companyId: input.companyId,
      collaboratorId: input.collaboratorId,
      serviceId: input.serviceId,
      commissionPercentage,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: CollaboratorServiceProps): CollaboratorServiceEntity {
    return new CollaboratorServiceEntity({ ...props });
  }

  updateCommission(newPercentage: number): void {
    this.props.commissionPercentage = CollaboratorServiceEntity.validateCommission(newPercentage);
    this.props.updatedAt = new Date();
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

  get commissionPercentage(): number {
    return this.props.commissionPercentage;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
