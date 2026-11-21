import type { PasswordHasher } from "../../../shared/cryptography/password-hasher.js";
import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import { CollaboratorEmailAlreadyInError, CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export interface UpdateCollaboratorCredentialsInput {
  collaboratorId: string;
  companyId: string;
  email?: string | undefined;
  password?: string | undefined;
}

export class UpdateCollaboratorCredentialsUseCase {
  constructor(
    private readonly collaboratorsRepository: CollaboratorsRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: UpdateCollaboratorCredentialsInput): Promise<void> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    let normalizedEmail: string | undefined;
    if (input.email) {
      normalizedEmail = input.email.trim().toLowerCase();
      if (normalizedEmail !== collaborator.email) {
        const exists = await this.collaboratorsRepository.existsByEmail(normalizedEmail);
        if (exists) {
          throw new CollaboratorEmailAlreadyInError();
        }
      }
    }

    if (input.password) {
      const passwordHash = await this.passwordHasher.hash(input.password);
      collaborator.updateCredentials(passwordHash, normalizedEmail);
    } else if (normalizedEmail) {
      collaborator.updateCredentials(collaborator.password, normalizedEmail);
    }

    await this.collaboratorsRepository.update(collaborator);
  }
}
