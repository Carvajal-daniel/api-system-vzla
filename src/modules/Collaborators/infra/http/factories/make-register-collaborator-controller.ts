import { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import { CollaboratorRepositoryDB } from "../../database/repositories/collaborators-repository.impl.js";
import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import { RegisterCollaboratorController } from "../controllers/register-collaborator.controller.js";

export function makeRegisterCollaboratorController() {
  const repository = new CollaboratorRepositoryDB();
  const passwordHasher = new BcryptPasswordHasher();
  const useCase = new RegisterCollaboratorUseCase(repository, passwordHasher);

  return new RegisterCollaboratorController(useCase);
}
