import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import type { PasswordHasher } from "../../../../../shared/cryptography/password-hasher.js";
import { ListCompanyCollaboratorsUseCase } from "../../../application/list-company-collaborators.usecase.js";
import { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import { UpdateCollaboratorStatusUseCase } from "../../../application/update-collaborator-status.usecase.js";
import type { CollaboratorsRepository } from "../../../domain/repository/collaborators.repository.interface.js";
import { CollaboratorRepositoryDB } from "../../database/repositories/collaborators-repository.impl.js";
import { CollaboratorsManagementController } from "../controllers/collaborators-management.controller.js";
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

export function makeCollaboratorsManagementController(
  deps: RegisterCollaboratorControllerDependencies = {},
) {
  const repository = deps.collaboratorsRepository ?? new CollaboratorRepositoryDB();

  return new CollaboratorsManagementController({
    listCompanyCollaboratorsUseCase: new ListCompanyCollaboratorsUseCase(repository),
    updateCollaboratorStatusUseCase: new UpdateCollaboratorStatusUseCase(repository),
  });
}
