export interface AuthOwnerRecord {
  readonly role: "OWNER";
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyTimezone: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
}

export interface AuthCollaboratorRecord {
  readonly role: "COLLABORATOR";
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyTimezone: string;
  readonly companyIsActive: boolean;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly specialty: string;
  readonly commissionPercentage: number;
  readonly isActive: boolean;
}

export type AuthIdentityRecord = AuthOwnerRecord | AuthCollaboratorRecord;

export interface CreateOwnerCompanyRecord {
  readonly id: string;
  readonly companyName: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly isActive: boolean;
  readonly timezone?: string | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AuthIdentityRepository {
  existsEmailInUse(email: string): Promise<boolean>;
  createOwnerCompany(record: CreateOwnerCompanyRecord): Promise<void>;
  findByEmail(email: string): Promise<AuthIdentityRecord | null>;
  findOwnerById(companyId: string): Promise<AuthOwnerRecord | null>;
  findCollaboratorById(
    collaboratorId: string,
    companyId: string,
  ): Promise<AuthCollaboratorRecord | null>;
}
