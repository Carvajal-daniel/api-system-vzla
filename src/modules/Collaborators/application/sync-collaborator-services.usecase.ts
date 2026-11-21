import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export interface SyncCollaboratorServicesInput {
  collaboratorId: string;
  companyId: string;
  services: Array<{
    serviceId: string;
    customCommissionRate?: number | null | undefined;
  }>;
}

export class SyncCollaboratorServicesUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: SyncCollaboratorServicesInput): Promise<void> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    await this.collaboratorsRepository.syncServices(
      input.collaboratorId,
      input.companyId,
      input.services,
    );
  }
}
