import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  CollaboratorServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { UnlinkCollaboratorFromServiceInputDTO } from "../dtos/service.dtos.js";

export class UnlinkCollaboratorFromServiceUseCase {
  constructor(
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
  ) {}

  async execute(
    actor: ActorContext,
    input: UnlinkCollaboratorFromServiceInputDTO,
  ): Promise<void> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    const link =
      await this.collaboratorServicesRepository.findByCollaboratorAndServiceInCompany(
        input.collaboratorId,
        input.serviceId,
        actor.companyId,
      );

    if (!link) {
      throw new CollaboratorServiceNotFoundError();
    }

    await this.collaboratorServicesRepository.delete(
      input.collaboratorId,
      input.serviceId,
      actor.companyId,
    );
  }
}
