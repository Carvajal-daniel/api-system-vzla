import { randomUUID } from "node:crypto";
import {
  InvalidServiceDescriptionError,
  InvalidServiceDurationError,
  InvalidServiceNameError,
  InvalidServicePriceError,
} from "../errors/service-errors.js";

export interface ServiceProps {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInCents: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceProps {
  companyId: string;
  name: string;
  description?: string | null | undefined;
  durationMinutes: number;
  priceInCents: number;
}

export interface UpdateServiceProps {
  name?: string | undefined;
  description?: string | null | undefined;
  durationMinutes?: number | undefined;
  priceInCents?: number | undefined;
}

const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

export class ServiceEntity {
  private constructor(private readonly props: ServiceProps) {}

  static normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  private static validateName(rawName: string): string {
    const trimmed = rawName.trim();

    if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
      throw new InvalidServiceNameError();
    }

    return trimmed;
  }

  private static validateDescription(rawDescription?: string | null): string | null {
    if (rawDescription === undefined || rawDescription === null) {
      return null;
    }

    const trimmed = rawDescription.trim();

    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      throw new InvalidServiceDescriptionError();
    }

    return trimmed;
  }

  private static validateDuration(durationMinutes: number): number {
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      throw new InvalidServiceDurationError();
    }

    return durationMinutes;
  }

  private static validatePrice(priceInCents: number): number {
    if (!Number.isInteger(priceInCents) || priceInCents < 0) {
      throw new InvalidServicePriceError();
    }

    return priceInCents;
  }

  static create(input: CreateServiceProps): ServiceEntity {
    const companyId = input.companyId.trim();
    if (!companyId) {
      throw new InvalidServiceNameError("Company identifier is required.");
    }

    const name = ServiceEntity.validateName(input.name);
    const description = ServiceEntity.validateDescription(input.description);
    const durationMinutes = ServiceEntity.validateDuration(input.durationMinutes);
    const priceInCents = ServiceEntity.validatePrice(input.priceInCents);
    const now = new Date();

    return new ServiceEntity({
      id: randomUUID(),
      companyId,
      name,
      description,
      durationMinutes,
      priceInCents,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: ServiceProps): ServiceEntity {
    return new ServiceEntity({ ...props });
  }

  update(input: UpdateServiceProps): void {
    const nextName =
      input.name !== undefined ? ServiceEntity.validateName(input.name) : this.props.name;
    const nextDescription =
      input.description !== undefined
        ? ServiceEntity.validateDescription(input.description)
        : this.props.description;
    const nextDuration =
      input.durationMinutes !== undefined
        ? ServiceEntity.validateDuration(input.durationMinutes)
        : this.props.durationMinutes;
    const nextPrice =
      input.priceInCents !== undefined
        ? ServiceEntity.validatePrice(input.priceInCents)
        : this.props.priceInCents;

    this.props.name = nextName;
    this.props.description = nextDescription;
    this.props.durationMinutes = nextDuration;
    this.props.priceInCents = nextPrice;
    this.props.updatedAt = new Date();
  }

  setActive(active: boolean): void {
    this.props.active = active;
    this.props.updatedAt = new Date();
  }

  get id(): string {
    return this.props.id;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get name(): string {
    return this.props.name;
  }

  get normalizedName(): string {
    return ServiceEntity.normalizeName(this.props.name);
  }

  get description(): string | null {
    return this.props.description;
  }

  get durationMinutes(): number {
    return this.props.durationMinutes;
  }

  get priceInCents(): number {
    return this.props.priceInCents;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
