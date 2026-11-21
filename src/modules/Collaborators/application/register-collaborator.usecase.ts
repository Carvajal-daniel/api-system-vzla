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
    const defaultRate = data.defaultCommissionRate ?? data.commissionPercentage ?? 0;
    const hiredAt = data.hiredAt ? new Date(data.hiredAt) : new Date();

    const collaborator = CollaboratorEntity.create({
      companyId: data.companyId,
      name: data.name.trim(),
      email: normalizedEmail,
      phone: data.phone.trim(),
      whatsapp: data.whatsapp ? data.whatsapp.trim() : null,
      specialty: data.specialty.trim(),
      bio: data.bio ? data.bio.trim() : null,
      password: passwordHash,
      commissionPercentage: defaultRate,
      defaultCommissionRate: defaultRate,
      monthlyRevenueGoal: data.monthlyRevenueGoal ?? null,
      avatarUrl: data.avatarUrl ?? null,
      hiredAt,
    });

    await this.collaboratorsRepository.save(collaborator);

    return {
      id: collaborator.id,
      name: collaborator.name,
      email: collaborator.email,
      companyId: collaborator.companyId,
      specialty: collaborator.specialty,
      phone: collaborator.phone,
      whatsapp: collaborator.whatsapp ?? null,
      bio: collaborator.bio ?? null,
      commissionPercentage: collaborator.commissionPercentage,
      defaultCommissionRate: collaborator.defaultCommissionRate,
      monthlyRevenueGoal: collaborator.monthlyRevenueGoal ?? null,
      status: collaborator.status,
      isActive: collaborator.isActive,
      avatarUrl: collaborator.avatarUrl ?? null,
      hiredAt: collaborator.hiredAt,
    };
  }
}
