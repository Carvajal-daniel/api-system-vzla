import type { CollaboratorRecord, CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import type { UpdateCollaboratorInputDTO } from "./collaborator-dto.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export class UpdateCollaboratorUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: UpdateCollaboratorInputDTO): Promise<CollaboratorRecord> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    collaborator.updateProfile({
      name: input.name?.trim(),
      phone: input.phone?.trim(),
      whatsapp: input.whatsapp ? input.whatsapp.trim() : input.whatsapp,
      specialty: input.specialty?.trim(),
      bio: input.bio ? input.bio.trim() : input.bio,
      defaultCommissionRate: input.defaultCommissionRate ?? input.commissionPercentage,
      monthlyRevenueGoal: input.monthlyRevenueGoal,
      hiredAt: input.hiredAt ? new Date(input.hiredAt) : undefined,
      avatarUrl: input.avatarUrl,
    });

    await this.collaboratorsRepository.update(collaborator);

    const [updatedRecord] = await this.collaboratorsRepository.findAllByCompanyId(input.companyId);
    const found = (await this.collaboratorsRepository.findAllByCompanyId(input.companyId)).find(
      (c) => c.id === input.collaboratorId,
    );

    if (!found) {
      throw new CollaboratorNotFoundError();
    }

    return found;
  }
}
