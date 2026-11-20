import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { CollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import type { ServiceCollaboratorOutputDTO } from "../dtos/service.dtos.js";

export class ListServiceCollaboratorsUseCase {
  constructor(
    private readonly servicesRepository: ServicesRepository,
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
    private readonly collaboratorLookupRepository: CollaboratorLookupRepository,
  ) {}

  async execute(
    actor: ActorContext,
    serviceId: string,
  ): Promise<ServiceCollaboratorOutputDTO[]> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    // Garante isolamento multi-tenant: o serviço precisa pertencer à empresa do OWNER autenticado.
    const service = await this.servicesRepository.findByIdInCompany(serviceId, actor.companyId);
    if (!service) {
      throw new ServiceNotFoundError();
    }

    const links = await this.collaboratorServicesRepository.findAllByServiceIdsInCompany(
      [service.id],
      actor.companyId,
    );

    if (links.length === 0) {
      return [];
    }

    const collaboratorIds = [...new Set(links.map((link) => link.collaboratorId))];
    const collaborators = await this.collaboratorLookupRepository.findByIdsInCompany(
      collaboratorIds,
      actor.companyId,
    );

    const collaboratorMap = new Map(
      collaborators.map((collaborator) => [collaborator.id, collaborator]),
    );

    const result: ServiceCollaboratorOutputDTO[] = [];
    for (const link of links) {
      const collaborator = collaboratorMap.get(link.collaboratorId);
      if (!collaborator) {
        continue;
      }

      result.push({
        collaboratorId: collaborator.id,
        name: collaborator.name,
        specialty: collaborator.specialty,
        isActive: collaborator.isActive,
        commissionPercentage: link.commissionPercentage,
      });
    }

    return result;
  }
}
