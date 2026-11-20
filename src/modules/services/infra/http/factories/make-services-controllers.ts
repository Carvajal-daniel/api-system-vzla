import { CreateServiceUseCase } from "../../../application/use-cases/create-service.use-case.js";
import { LinkCollaboratorToServiceUseCase } from "../../../application/use-cases/link-collaborator-to-service.use-case.js";
import { ListCollaboratorAssignedServicesUseCase } from "../../../application/use-cases/list-collaborator-assigned-services.use-case.js";
import { ListCompanyServicesUseCase } from "../../../application/use-cases/list-company-services.use-case.js";
import { ListPublicCompanyCatalogUseCase } from "../../../application/use-cases/list-public-company-catalog.use-case.js";
import { ListServiceCollaboratorsUseCase } from "../../../application/use-cases/list-service-collaborators.use-case.js";
import { UnlinkCollaboratorFromServiceUseCase } from "../../../application/use-cases/unlink-collaborator-from-service.use-case.js";
import { UpdateCollaboratorServiceCommissionUseCase } from "../../../application/use-cases/update-collaborator-service-commission.use-case.js";
import { UpdateServiceStatusUseCase } from "../../../application/use-cases/update-service-status.use-case.js";
import { UpdateServiceUseCase } from "../../../application/use-cases/update-service.use-case.js";
import type { CollaboratorLookupRepository } from "../../../domain/repositories/collaborator-lookup.repository.js";
import type { CollaboratorServicesRepository } from "../../../domain/repositories/collaborator-services.repository.js";
import type { CompanyLookupRepository } from "../../../domain/repositories/company-lookup.repository.js";
import type { ServicesRepository } from "../../../domain/repositories/services.repository.js";
import { DrizzleCollaboratorLookupRepository } from "../../database/repositories/drizzle-collaborator-lookup.repository.js";
import { DrizzleCollaboratorServicesRepository } from "../../database/repositories/drizzle-collaborator-services.repository.js";
import { DrizzleCompanyLookupRepository } from "../../database/repositories/drizzle-company-lookup.repository.js";
import { DrizzleServicesRepository } from "../../database/repositories/drizzle-services.repository.js";
import { CollaboratorServicesController } from "../controllers/collaborator-services.controller.js";
import { PublicCatalogController } from "../controllers/public-catalog.controller.js";
import { ServicesController } from "../controllers/services.controller.js";

export interface ServicesControllersDependencies {
  servicesRepository?: ServicesRepository;
  collaboratorLookupRepository?: CollaboratorLookupRepository;
  collaboratorServicesRepository?: CollaboratorServicesRepository;
  companyLookupRepository?: CompanyLookupRepository;
}

export function makeServicesController(
  deps: ServicesControllersDependencies = {},
): ServicesController {
  const servicesRepository = deps.servicesRepository ?? new DrizzleServicesRepository();

  return new ServicesController({
    createServiceUseCase: new CreateServiceUseCase(servicesRepository),
    listCompanyServicesUseCase: new ListCompanyServicesUseCase(servicesRepository),
    updateServiceUseCase: new UpdateServiceUseCase(servicesRepository),
    updateServiceStatusUseCase: new UpdateServiceStatusUseCase(servicesRepository),
  });
}

export function makeCollaboratorServicesController(
  deps: ServicesControllersDependencies = {},
): CollaboratorServicesController {
  const servicesRepository = deps.servicesRepository ?? new DrizzleServicesRepository();
  const collaboratorLookupRepository =
    deps.collaboratorLookupRepository ?? new DrizzleCollaboratorLookupRepository();
  const collaboratorServicesRepository =
    deps.collaboratorServicesRepository ?? new DrizzleCollaboratorServicesRepository();

  return new CollaboratorServicesController({
    linkCollaboratorToServiceUseCase: new LinkCollaboratorToServiceUseCase(
      servicesRepository,
      collaboratorLookupRepository,
      collaboratorServicesRepository,
    ),
    updateCollaboratorServiceCommissionUseCase: new UpdateCollaboratorServiceCommissionUseCase(
      collaboratorServicesRepository,
    ),
    unlinkCollaboratorFromServiceUseCase: new UnlinkCollaboratorFromServiceUseCase(
      collaboratorServicesRepository,
    ),
    listCollaboratorAssignedServicesUseCase: new ListCollaboratorAssignedServicesUseCase(
      servicesRepository,
      collaboratorServicesRepository,
    ),
    listServiceCollaboratorsUseCase: new ListServiceCollaboratorsUseCase(
      servicesRepository,
      collaboratorServicesRepository,
      collaboratorLookupRepository,
    ),
  });
}

export function makePublicCatalogController(
  deps: ServicesControllersDependencies = {},
): PublicCatalogController {
  const servicesRepository = deps.servicesRepository ?? new DrizzleServicesRepository();
  const collaboratorServicesRepository =
    deps.collaboratorServicesRepository ?? new DrizzleCollaboratorServicesRepository();
  const collaboratorLookupRepository =
    deps.collaboratorLookupRepository ?? new DrizzleCollaboratorLookupRepository();
  const companyLookupRepository =
    deps.companyLookupRepository ?? new DrizzleCompanyLookupRepository();

  return new PublicCatalogController(
    new ListPublicCompanyCatalogUseCase(
      servicesRepository,
      collaboratorServicesRepository,
      collaboratorLookupRepository,
      companyLookupRepository,
    ),
  );
}
