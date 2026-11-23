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
      ...(company.currency ? { currency: company.currency } : {}),
      avatarUrl: company.avatarUrl ?? null,
      ...(company.operatingDays != null ? { operatingDays: company.operatingDays } : {}),
      ...(company.operatingSchedule != null ? { operatingSchedule: company.operatingSchedule } : {}),
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

    // Fallback: busca todos os colaboradores ativos da empresa para serviços sem vínculo explícito
    const allCompanyCollaborators =
      await this.collaboratorLookupRepository.findAllActiveInCompany(companyId);

    const uniqueCollaboratorIds = [...new Set(links.map((link) => link.collaboratorId))];
    const activeCollaborators =
      uniqueCollaboratorIds.length > 0
        ? await this.collaboratorLookupRepository.findActiveByIdsInCompany(
            uniqueCollaboratorIds,
            companyId,
          )
        : allCompanyCollaborators;

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
        avatarUrl: collaborator.avatarUrl ?? null,
      });
      collaboratorsByService.set(link.serviceId, list);
    }

    // Para serviços sem vínculos exclusivos cadastrados, todos os profissionais ativos atendem
    const fallbackCollaborators: PublicCatalogCollaboratorOutputDTO[] =
      allCompanyCollaborators.map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty,
        avatarUrl: c.avatarUrl ?? null,
      }));

    return {
      company: companyInfo,
      services: activeServices.map((service) => {
        const assigned = collaboratorsByService.get(service.id);
        const collaborators =
          assigned && assigned.length > 0 ? assigned : fallbackCollaborators;

        return {
          id: service.id,
          name: service.name,
          description: service.description,
          durationMinutes: service.durationMinutes,
          priceInCents: service.priceInCents,
          imageUrl: service.imageUrl ?? null,
          collaborators,
        };
      }),
    };
  }
}
