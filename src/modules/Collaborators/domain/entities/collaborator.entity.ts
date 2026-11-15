import { randomUUID } from "node:crypto";

export interface CollaboratorProps {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  companyId: string;
  specialty: string;
  commissionPercentage: number;
  isActive: boolean;
}

export type CreateCollaboratorProps = Omit<CollaboratorProps, "id" | "isActive">;

export class CollaboratorEntity {
  private constructor(private readonly props: CollaboratorProps) {}

  static create(props: CreateCollaboratorProps): CollaboratorEntity {
    return new CollaboratorEntity({ ...props, id: randomUUID(), isActive: true });
  }

  get id(): string { return this.props.id; }
  get name(): string { return this.props.name; }
  get email(): string { return this.props.email; }
  get password(): string { return this.props.password; }
  get phone(): string { return this.props.phone; }
  get companyId(): string { return this.props.companyId; }
  get specialty(): string { return this.props.specialty; }
  get commissionPercentage(): number { return this.props.commissionPercentage; }
  get isActive(): boolean { return this.props.isActive; }
}
