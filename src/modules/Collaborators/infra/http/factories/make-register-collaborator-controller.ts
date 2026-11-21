import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import type { PasswordHasher } from "../../../../../shared/cryptography/password-hasher.js";
import { CloseMonthAwardUseCase } from "../../../application/close-month-award.usecase.js";
import { CountFutureAppointmentsUseCase } from "../../../application/count-future-appointments.usecase.js";
import { DeactivateCollaboratorUseCase } from "../../../application/deactivate-collaborator.usecase.js";
import { GetCollaboratorProfileUseCase } from "../../../application/get-collaborator-profile.usecase.js";
import { ListCompanyCollaboratorsUseCase } from "../../../application/list-company-collaborators.usecase.js";
import { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import { SyncCollaboratorScheduleUseCase } from "../../../application/sync-collaborator-schedule.usecase.js";
import { SyncCollaboratorServicesUseCase } from "../../../application/sync-collaborator-services.usecase.js";
import { UpdateCollaboratorCredentialsUseCase } from "../../../application/update-collaborator-credentials.usecase.js";
import { UpdateCollaboratorStatusUseCase } from "../../../application/update-collaborator-status.usecase.js";
import { UpdateCollaboratorUseCase } from "../../../application/update-collaborator.usecase.js";
import { UploadCollaboratorAvatarUseCase } from "../../../application/upload-collaborator-avatar.usecase.js";
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
  const passwordHasher = deps.passwordHasher ?? new BcryptPasswordHasher();

  return new CollaboratorsManagementController({
    listCompanyCollaboratorsUseCase: new ListCompanyCollaboratorsUseCase(repository),
    getCollaboratorProfileUseCase: new GetCollaboratorProfileUseCase(repository),
    updateCollaboratorUseCase: new UpdateCollaboratorUseCase(repository),
    syncCollaboratorServicesUseCase: new SyncCollaboratorServicesUseCase(repository),
    syncCollaboratorScheduleUseCase: new SyncCollaboratorScheduleUseCase(repository),
    updateCollaboratorCredentialsUseCase: new UpdateCollaboratorCredentialsUseCase(
      repository,
      passwordHasher,
    ),
    countFutureAppointmentsUseCase: new CountFutureAppointmentsUseCase(repository),
    deactivateCollaboratorUseCase: new DeactivateCollaboratorUseCase(repository),
    uploadCollaboratorAvatarUseCase: new UploadCollaboratorAvatarUseCase(repository),
    closeMonthAwardUseCase: new CloseMonthAwardUseCase(repository),
    updateCollaboratorStatusUseCase: new UpdateCollaboratorStatusUseCase(repository),
    collaboratorsRepository: repository,
  });
}
