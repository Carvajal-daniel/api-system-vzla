import type { CollaboratorEntity } from "../entities/collaborator.entity.js";

export interface CollaboratorRecord {
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly specialty: string;
  readonly commissionPercentage: number;
  readonly isActive: boolean;
}

export interface CollaboratorsRepository {
  existsByEmail(email: string): Promise<boolean>;
  companyExistsById(companyId: string): Promise<boolean>;
  save(collaborator: CollaboratorEntity): Promise<void>;
  findAllByCompanyId(companyId: string): Promise<CollaboratorRecord[]>;
  updateStatusInCompany(
    collaboratorId: string,
    companyId: string,
    isActive: boolean,
  ): Promise<CollaboratorRecord | null>;
}
