import type { CollaboratorServiceEntity } from "../entities/collaborator-service.entity.js";

export interface CollaboratorServicesRepository {
  findByCollaboratorAndServiceInCompany(
    collaboratorId: string,
    serviceId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity | null>;
  findAllByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]>;
  findAllByServiceIdsInCompany(
    serviceIds: string[],
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]>;
  create(link: CollaboratorServiceEntity): Promise<void>;
  save(link: CollaboratorServiceEntity): Promise<void>;
  delete(collaboratorId: string, serviceId: string, companyId: string): Promise<void>;
}
