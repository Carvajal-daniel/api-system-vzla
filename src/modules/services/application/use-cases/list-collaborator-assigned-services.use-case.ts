import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { UnauthorizedServiceActionError } from "../../domain/errors/service-errors.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import type { CollaboratorAssignedServiceOutputDTO } from "../dtos/service.dtos.js";

export class ListCollaboratorAssignedServicesUseCase {
  constructor(
    private readonly servicesRepository: ServicesRepository,
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
  ) {}

  async execute(actor: ActorContext): Promise<CollaboratorAssignedServiceOutputDTO[]> {
    if (actor.role !== "COLLABORATOR") {
      throw new UnauthorizedServiceActionError(
        "Only collaborators can access their own assigned services.",
      );
    }

    const links = await this.collaboratorServicesRepository.findAllByCollaboratorInCompany(
      actor.collaboratorId,
      actor.companyId,
    );

    if (links.length === 0) {
      return [];
    }

    const services = await this.servicesRepository.findAllByCompany(actor.companyId);
    const serviceMap = new Map(services.map((service) => [service.id, service]));

    const result: CollaboratorAssignedServiceOutputDTO[] = [];

    for (const link of links) {
      const service = serviceMap.get(link.serviceId);
      if (!service) {
        continue;
      }

      result.push({
        serviceId: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceInCents: service.priceInCents,
        active: service.active,
        commissionPercentage: link.commissionPercentage,
      });
    }

    return result;
  }
}
