import { PublicCompanyNotFoundError } from "../../domain/errors/service-errors.js";
import type { CollaboratorLookupRepository } from "../../domain/repositories/collaborator-lookup.repository.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";
import type { CompanyLookupRepository } from "../../domain/repositories/company-lookup.repository.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import type {
  PublicCatalogCollaboratorOutputDTO,
  PublicCompanyCatalogOutputDTO,
} from "../dtos/service.dtos.js";

export class ListPublicCompanyCatalogUseCase {
  constructor(
    private readonly servicesRepository: ServicesRepository,
    private readonly collaboratorServicesRepository: CollaboratorServicesRepository,
    private readonly collaboratorLookupRepository: CollaboratorLookupRepository,
    private readonly companyLookupRepository: CompanyLookupRepository,
  ) {}

  async execute(companyId: string): Promise<PublicCompanyCatalogOutputDTO> {
    // Bloqueia exposição de catálogo para empresas inexistentes ou desativadas.
    const company = await this.companyLookupRepository.findById(companyId);
    if (!company || !company.isActive) {
      throw new PublicCompanyNotFoundError();
    }

    const companyInfo = {
      id: company.id,
      companyName: company.companyName,
      timezone: company.timezone,
    };

    const activeServices = await this.servicesRepository.findActiveByCompany(companyId);

    if (activeServices.length === 0) {
      return {
        company: companyInfo,
        services: [],
      };
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

    return {
      company: companyInfo,
      services: activeServices.map((service) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        durationMinutes: service.durationMinutes,
        priceInCents: service.priceInCents,
        collaborators: collaboratorsByService.get(service.id) ?? [],
      })),
    };
  }
}
