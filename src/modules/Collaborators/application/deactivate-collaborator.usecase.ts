import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export interface DeactivateCollaboratorInput {
  collaboratorId: string;
  companyId: string;
  reason?: string | null | undefined;
  queueAiReschedule: boolean;
}

export class DeactivateCollaboratorUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: DeactivateCollaboratorInput): Promise<{ message: string; queuedCount: number }> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    const { queuedCount } = await this.collaboratorsRepository.deactivateAndQueueReschedule(
      input.collaboratorId,
      input.companyId,
      input.reason,
      input.queueAiReschedule,
    );

    return {
      message: "Colaborador desativado com sucesso.",
      queuedCount,
    };
  }
}
