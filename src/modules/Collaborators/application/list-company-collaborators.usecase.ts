import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";

export interface CollaboratorOutputDTO {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly specialty: string;
  readonly commissionPercentage: number;
  readonly isActive: boolean;
  readonly role: "COLLABORATOR";
  readonly avatarUrl?: string | null;
}

export class ListCompanyCollaboratorsUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(companyId: string): Promise<CollaboratorOutputDTO[]> {
    const records = await this.collaboratorsRepository.findAllByCompanyId(companyId);

    return records.map((record) => ({
      id: record.id,
      name: record.name,
      email: record.email,
      phone: record.phone,
      specialty: record.specialty,
      commissionPercentage: record.commissionPercentage,
      isActive: record.isActive,
      role: "COLLABORATOR",
      avatarUrl: record.avatarUrl ?? null,
    }));
  }
}
