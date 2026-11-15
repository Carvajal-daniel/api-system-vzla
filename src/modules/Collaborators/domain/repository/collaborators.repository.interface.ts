import type { CollaboratorEntity } from "../entities/collaborator.entity.js";

export interface CollaboratorsRepository {
  existsByEmail(email: string): Promise<boolean>;
  companyExistsById(companyId: string): Promise<boolean>;
  save(collaborator: CollaboratorEntity): Promise<void>;
}
