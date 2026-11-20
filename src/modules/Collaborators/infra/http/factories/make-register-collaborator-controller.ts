import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import type { PasswordHasher } from "../../../../../shared/cryptography/password-hasher.js";
import { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import { CollaboratorRepositoryDB } from "../../database/repositories/collaborators-repository.impl.js";
import { RegisterCollaboratorController } from "../controllers/register-collaborator.controller.js";

export interface RegisterCollaboratorControllerDependencies {
  collaboratorsRepository?: CollaboratorsRepository;
  passwordHasher?: PasswordHasher;
}

export function makeRegisterCollaboratorController(
  deps: RegisterCollaboratorControllerDependencies = {},
) {
  const repository = deps.collaboratorsRepository ?? new CollaboratorRepositoryDB();
  const passwordHasher = deps.passwordHasher ?? new BcryptPasswordHasher();
  const useCase = new RegisterCollaboratorUseCase(repository, passwordHasher);

  return new RegisterCollaboratorController(useCase);
}
