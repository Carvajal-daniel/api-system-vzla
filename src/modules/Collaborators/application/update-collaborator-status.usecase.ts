import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import {
  CannotModifyOwnOwnerStatusError,
  CollaboratorRecordNotFoundError,
} from "./errors/collaborator-errors.js";
import type { CollaboratorOutputDTO } from "./list-company-collaborators.usecase.js";

export interface UpdateCollaboratorStatusInput {
  readonly actorUserId: string;
  readonly companyId: string;
  readonly collaboratorId: string;
  readonly isActive: boolean;
}

export class UpdateCollaboratorStatusUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: UpdateCollaboratorStatusInput): Promise<CollaboratorOutputDTO> {
    // Impede que o OWNER tente alterar o status da própria conta por esta rota de gestão de colaboradores.
    if (input.collaboratorId === input.actorUserId || input.collaboratorId === input.companyId) {
      throw new CannotModifyOwnOwnerStatusError();
    }

    const updated = await this.collaboratorsRepository.updateStatusInCompany(
      input.collaboratorId,
      input.companyId,
      input.isActive,
    );

    if (!updated) {
      throw new CollaboratorRecordNotFoundError();
    }

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      specialty: updated.specialty,
      commissionPercentage: updated.commissionPercentage,
      isActive: updated.isActive,
      role: "COLLABORATOR",
    };
  }
}
