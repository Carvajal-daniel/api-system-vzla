import type { CollaboratorsRepository } from "../domain/repository/collaborators.repository.interface.js";
import {
  type CollaboratorDayScheduleInput,
  CollaboratorScheduleValidator,
  type CompanyOperatingContext,
} from "../domain/services/collaborator-schedule-validator.service.js";
import { CollaboratorNotFoundError } from "./errors/collaborator-errors.js";

export interface SyncCollaboratorScheduleInput {
  collaboratorId: string;
  companyId: string;
  schedules: CollaboratorDayScheduleInput[];
  companyContext: CompanyOperatingContext;
}

export class SyncCollaboratorScheduleUseCase {
  constructor(private readonly collaboratorsRepository: CollaboratorsRepository) {}

  async execute(input: SyncCollaboratorScheduleInput): Promise<CollaboratorDayScheduleInput[]> {
    const collaborator = await this.collaboratorsRepository.findById(
      input.collaboratorId,
      input.companyId,
    );

    if (!collaborator) {
      throw new CollaboratorNotFoundError();
    }

    // Validação estrita de domínio contra o horário da empresa
    const validatedSchedules = CollaboratorScheduleValidator.validate(
      input.schedules,
      input.companyContext,
    );

    await this.collaboratorsRepository.syncSchedules(
      input.collaboratorId,
      input.companyId,
      validatedSchedules,
    );

    return validatedSchedules;
  }
}
