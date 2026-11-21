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
  readonly avatarUrl?: string | null;
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
  updateDetailsInCompany?(
    collaboratorId: string,
    companyId: string,
    data: { name?: string; specialty?: string; commissionPercentage?: number },
  ): Promise<CollaboratorRecord | null>;
  deleteInCompany?(
    collaboratorId: string,
    companyId: string,
    transferToCollaboratorId?: string,
  ): Promise<"deleted" | "not_found" | "has_appointments" | "destination_not_found">;
}
