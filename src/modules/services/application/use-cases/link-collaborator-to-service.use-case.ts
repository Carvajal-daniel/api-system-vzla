import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { CollaboratorServiceEntity } from "../../domain/entities/collaborator-service.entity.js";
import {
  CollaboratorNotFoundError,
  CollaboratorServiceAlreadyExistsError,
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { CollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import {
  type CollaboratorServiceOutputDTO,
  type LinkCollaboratorToServiceInputDTO,
  toCollaboratorServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class LinkCollaboratorToServiceUseCase {
  constructor(
    private readonly servicesRepository: ServicesRepository,
    private readonly collaboratorLookupRepository: CollaboratorLookupRepository,
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
  ) {}

  async execute(
    actor: ActorContext,
    input: LinkCollaboratorToServiceInputDTO,
  ): Promise<CollaboratorServiceOutputDTO> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    const link = CollaboratorServiceEntity.create({
      companyId: actor.companyId,
      collaboratorId: input.collaboratorId,
      serviceId: input.serviceId,
      commissionPercentage: input.commissionPercentage,
    });

    const service = await this.servicesRepository.findByIdInCompany(
      input.serviceId,
      actor.companyId,
    );
    if (!service) {
      throw new ServiceNotFoundError();
    }

    const collaborator = await this.collaboratorLookupRepository.findByIdInCompany(
      input.collaboratorId,
      actor.companyId,
    );
    if (!collaborator || !collaborator.isActive) {
      throw new CollaboratorNotFoundError();
    }

    const existing =
      await this.collaboratorServicesRepository.findByCollaboratorAndServiceInCompany(
        input.collaboratorId,
        input.serviceId,
        actor.companyId,
      );
    if (existing) {
      throw new CollaboratorServiceAlreadyExistsError();
    }

    await this.collaboratorServicesRepository.create(link);

    return toCollaboratorServiceOutputDTO(link);
  }
}
