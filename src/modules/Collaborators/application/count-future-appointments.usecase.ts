import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export class CountFutureAppointmentsUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(collaboratorId: string, companyId: string): Promise<{ futureAppointmentsCount: number }> {
    const collaborator = await this.collaboratorsRepository.findById(collaboratorId, companyId);
    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    const count = await this.collaboratorsRepository.countFutureAppointments(
      collaboratorId,
      companyId,
    );

    return { futureAppointmentsCount: count };
  }
}
