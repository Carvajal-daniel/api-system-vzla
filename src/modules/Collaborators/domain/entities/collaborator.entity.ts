import { randomUUID } from "node:crypto";

export type CollaboratorStatus = "ACTIVE" | "INACTIVE";

export interface CollaboratorProps {
  id: string;
  companyId: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  whatsapp?: string | null;
  specialty: string;
  bio?: string | null;
  commissionPercentage: number;
  defaultCommissionRate: number;
  monthlyRevenueGoal?: number | null;
  status: CollaboratorStatus;
  isActive: boolean;
  avatarUrl?: string | null;
  hiredAt: Date;
  deactivatedAt?: Date | null;
  deactivationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateCollaboratorProps = Omit<
  CollaboratorProps,
  "id" | "status" | "isActive" | "createdAt" | "updatedAt" | "defaultCommissionRate" | "hiredAt"
> & {
  defaultCommissionRate?: number;
  hiredAt?: Date;
  status?: CollaboratorStatus;
  isActive?: boolean;
};

/**
 * Entidade de domínio rica do Colaborador.
 * Encapsula regras de negócio, dados cadastrais, perfil público e ciclo de vida profissional.
 */
export class CollaboratorEntity {
  private constructor(private readonly props: CollaboratorProps) {}

  static create(props: CreateCollaboratorProps): CollaboratorEntity {
    const defaultRate = props.defaultCommissionRate ?? props.commissionPercentage ?? 0;
    const now = new Date();
    const status: CollaboratorStatus = props.status ?? "ACTIVE";

    return new CollaboratorEntity({
      id: randomUUID(),
      companyId: props.companyId,
      name: props.name,
      email: props.email,
      password: props.password,
      phone: props.phone,
      whatsapp: props.whatsapp ?? null,
      specialty: props.specialty,
      bio: props.bio ?? null,
      commissionPercentage: defaultRate,
      defaultCommissionRate: defaultRate,
      monthlyRevenueGoal: props.monthlyRevenueGoal ?? null,
      status,
      isActive: status === "ACTIVE",
      avatarUrl: props.avatarUrl ?? null,
      hiredAt: props.hiredAt ?? now,
      deactivatedAt: null,
      deactivationReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: CollaboratorProps): CollaboratorEntity {
    return new CollaboratorEntity(props);
  }

  // Getters para propriedades de leitura
  get id(): string { return this.props.id; }
  get companyId(): string { return this.props.companyId; }
  get name(): string { return this.props.name; }
  get email(): string { return this.props.email; }
  get password(): string { return this.props.password; }
  get phone(): string { return this.props.phone; }
  get whatsapp(): string | null | undefined { return this.props.whatsapp; }
  get specialty(): string { return this.props.specialty; }
  get bio(): string | null | undefined { return this.props.bio; }
  get commissionPercentage(): number { return this.props.commissionPercentage; }
  get defaultCommissionRate(): number { return this.props.defaultCommissionRate; }
  get monthlyRevenueGoal(): number | null | undefined { return this.props.monthlyRevenueGoal; }
  get status(): CollaboratorStatus { return this.props.status; }
  get isActive(): boolean { return this.props.isActive; }
  get avatarUrl(): string | null | undefined { return this.props.avatarUrl; }
  get hiredAt(): Date { return this.props.hiredAt; }
  get deactivatedAt(): Date | null | undefined { return this.props.deactivatedAt; }
  get deactivationReason(): string | null | undefined { return this.props.deactivationReason; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  // Métodos de negócio para mutação controlada
  deactivate(reason?: string): void {
    this.props.status = "INACTIVE";
    this.props.isActive = false;
    this.props.deactivatedAt = new Date();
    this.props.deactivationReason = reason ?? null;
    this.props.updatedAt = new Date();
  }

  activate(): void {
    this.props.status = "ACTIVE";
    this.props.isActive = true;
    this.props.deactivatedAt = null;
    this.props.deactivationReason = null;
    this.props.updatedAt = new Date();
  }

  updateProfile(data: {
    name?: string | undefined;
    phone?: string | undefined;
    whatsapp?: string | null | undefined;
    specialty?: string | undefined;
    bio?: string | null | undefined;
    defaultCommissionRate?: number | undefined;
    monthlyRevenueGoal?: number | null | undefined;
    hiredAt?: Date | undefined;
    avatarUrl?: string | null | undefined;
  }): void {
    if (data.name !== undefined) this.props.name = data.name;
    if (data.phone !== undefined) this.props.phone = data.phone;
    if (data.whatsapp !== undefined) this.props.whatsapp = data.whatsapp;
    if (data.specialty !== undefined) this.props.specialty = data.specialty;
    if (data.bio !== undefined) this.props.bio = data.bio;
    if (data.defaultCommissionRate !== undefined) {
      this.props.defaultCommissionRate = data.defaultCommissionRate;
      this.props.commissionPercentage = data.defaultCommissionRate;
    }
    if (data.monthlyRevenueGoal !== undefined) this.props.monthlyRevenueGoal = data.monthlyRevenueGoal;
    if (data.hiredAt !== undefined) this.props.hiredAt = data.hiredAt;
    if (data.avatarUrl !== undefined) this.props.avatarUrl = data.avatarUrl;
    this.props.updatedAt = new Date();
  }

  updateCredentials(passwordHash: string, email?: string): void {
    this.props.password = passwordHash;
    if (email) this.props.email = email;
    this.props.updatedAt = new Date();
  }
}
