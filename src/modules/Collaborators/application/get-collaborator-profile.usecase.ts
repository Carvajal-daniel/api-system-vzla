import type {
  CollaboratorProfileDossier,
  CollaboratorsRepository,
} from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export class GetCollaboratorProfileUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(
    collaboratorId: string,
    companyId: string,
    referenceDate?: Date,
  ): Promise<CollaboratorProfileDossier> {
    const dossier = await this.collaboratorsRepository.getProfileDossier(
      collaboratorId,
      companyId,
      referenceDate,
    );

    if (!dossier) {
      throw new CollaboratorNotFoundError();
    }

    return dossier;
  }
}
