import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  CollaboratorServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import {
  type CollaboratorServiceOutputDTO,
  type UpdateCollaboratorServiceCommissionInputDTO,
  toCollaboratorServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class UpdateCollaboratorServiceCommissionUseCase {
  constructor(
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
  ) {}

  async execute(
    actor: ActorContext,
    input: UpdateCollaboratorServiceCommissionInputDTO,
  ): Promise<CollaboratorServiceOutputDTO> {
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

    link.updateCommission(input.commissionPercentage);
    await this.collaboratorServicesRepository.save(link);

    return toCollaboratorServiceOutputDTO(link);
  }
}
