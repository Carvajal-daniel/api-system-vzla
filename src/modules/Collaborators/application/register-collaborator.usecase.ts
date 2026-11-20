import { CollaboratorEntity } from "../domain/entities/collaborator.entity.js";
import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorCompanyNotFoundError, CollaboratorEmailAlreadyInError } from "./errors/collaborator-errors.js";
import type { PasswordHasher } from "../../../shared/cryptography/password-hasher.js";
import type { RegisterCollaboratorInputDTO, RegisterCollaboratorOutputDTO } from "./collaborator-dto.js";

export class RegisterCollaboratorUseCase {
  constructor(
    private readonly collaboratorsRepository: CollaboratorsRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(data: RegisterCollaboratorInputDTO): Promise<RegisterCollaboratorOutputDTO> {
    const normalizedEmail = data.email.trim().toLowerCase();

    if (!(await this.collaboratorsRepository.companyExistsById(data.companyId))) {
      throw new CollaboratorCompanyNotFoundError();
    }

    // Garante unicidade global do e-mail entre empresas e colaboradores para evitar conflito no login.
    if (await this.collaboratorsRepository.existsByEmail(normalizedEmail)) {
      throw new CollaboratorEmailAlreadyInError();
    }

    const passwordHash = await this.passwordHasher.hash(data.password);
    const collaborator = CollaboratorEntity.create({
      ...data,
      name: data.name.trim(),
      email: normalizedEmail,
      phone: data.phone.trim(),
      specialty: data.specialty.trim(),
      password: passwordHash,
    });

    await this.collaboratorsRepository.save(collaborator);

    return {
      id: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      companyId: collaborator.companyId,
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
    };
  }
}
