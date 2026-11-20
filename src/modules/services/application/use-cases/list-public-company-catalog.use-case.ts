import type { CollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import type {
  PublicCatalogCollaboratorOutputDTO,
  PublicCatalogServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class ListPublicCompanyCatalogUseCase {
  constructor(
    private readonly servicesRepository: ServicesRepository,
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
    private readonly collaboratorLookupRepository: CollaboratorLookupRepository,
  ) {}

  async execute(companyId: string): Promise<PublicCatalogServiceOutputDTO[]> {
    const activeServices = await this.servicesRepository.findActiveByCompany(companyId);

    if (activeServices.length === 0) {
      return [];
    }

    const serviceIds = activeServices.map((service) => service.id);
    const links = await this.collaboratorServicesRepository.findAllByServiceIdsInCompany(
      serviceIds,
      companyId,
    );

    const uniqueCollaboratorIds = [...new Set(links.map((link) => link.collaboratorId))];
    const activeCollaborators =
      await this.collaboratorLookupRepository.findActiveByIdsInCompany(
        uniqueCollaboratorIds,
        companyId,
      );

    const collaboratorMap = new Map(
      activeCollaborators.map((collaborator) => [collaborator.id, collaborator]),
    );

    const collaboratorsByService = new Map<string, PublicCatalogCollaboratorOutputDTO[]>();

    for (const link of links) {
      const collaborator = collaboratorMap.get(link.collaboratorId);
      if (!collaborator) {
        continue;
      }

      const list = collaboratorsByService.get(link.serviceId) ?? [];
      list.push({
        id: collaborator.id,
        name: collaborator.name,
        specialty: collaborator.specialty,
      });
      collaboratorsByService.set(link.serviceId, list);
    }

    return activeServices.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      priceInCents: service.priceInCents,
      collaborators: collaboratorsByService.get(service.id) ?? [],
    }));
  }
}
