import { beforeEach, describe, expect, it } from "vitest";
import { CollaboratorServiceEntity } from "../../domain/entities/collaborator-service.entity.js";
import { ServiceEntity } from "../../domain/entities/service.entity.js";
import { PublicCompanyNotFoundError } from "../../domain/errors/service-errors.js";
import { ListPublicCompanyCatalogUseCase } from "../use-cases/list-public-company-catalog.use-case.js";
import { InMemoryCollaboratorLookupRepository } from "./in-memory-collaborator-lookup.repository.js";
import { InMemoryCollaboratorServicesRepository } from "./in-memory-collaborator-services.repository.js";
import { InMemoryCompanyLookupRepository } from "./in-memory-company-lookup.repository.js";
import { InMemoryServicesRepository } from "./in-memory-services.repository.js";

describe("Public Company Catalog Use Case (US5)", () => {
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";
  const inactiveCompany = "33333333-3333-4333-8333-333333333333";
  const unknownCompany = "99999999-9999-4999-8999-999999999999";

  let servicesRepo: InMemoryServicesRepository;
  let linksRepo: InMemoryCollaboratorServicesRepository;
  let collaboratorLookupRepo: InMemoryCollaboratorLookupRepository;
  let companyLookupRepo: InMemoryCompanyLookupRepository;
  let useCase: ListPublicCompanyCatalogUseCase;

  beforeEach(() => {
    servicesRepo = new InMemoryServicesRepository();
    linksRepo = new InMemoryCollaboratorServicesRepository();
    collaboratorLookupRepo = new InMemoryCollaboratorLookupRepository();
    companyLookupRepo = new InMemoryCompanyLookupRepository();

    companyLookupRepo.seed({
      id: companyA,
      companyName: "Barbearia Norte",
      timezone: "America/Sao_Paulo",
      isActive: true,
    });
    companyLookupRepo.seed({
      id: companyB,
      companyName: "Salon Sur",
      timezone: "America/Caracas",
      isActive: true,
    });
    companyLookupRepo.seed({
      id: inactiveCompany,
      companyName: "Salon Inactivo",
      timezone: "America/Caracas",
      isActive: false,
    });

    useCase = new ListPublicCompanyCatalogUseCase(
      servicesRepo,
      linksRepo,
      collaboratorLookupRepo,
      companyLookupRepo,
    );
  });

  it("returns company info, only active services, and active linked collaborators without exposing commissions or other companies", async () => {
    const activeService = ServiceEntity.create({
      companyId: companyA,
      name: "Corte Clásico",
      description: "Con tijera y máquina",
      durationMinutes: 45,
      priceInCents: 3500,
    });
    const inactiveService = ServiceEntity.create({
      companyId: companyA,
      name: "Servicio Desactivado",
      durationMinutes: 30,
      priceInCents: 2000,
    });
    inactiveService.setActive(false);

    const serviceWithoutCollaborators = ServiceEntity.create({
      companyId: companyA,
      name: "Lavado Express",
      durationMinutes: 15,
      priceInCents: 1000,
    });

    const otherCompanyService = ServiceEntity.create({
      companyId: companyB,
      name: "Servicio Empresa B",
      durationMinutes: 60,
      priceInCents: 5000,
    });

    await servicesRepo.create(activeService);
    await servicesRepo.create(inactiveService);
    await servicesRepo.create(serviceWithoutCollaborators);
    await servicesRepo.create(otherCompanyService);

    const activeCollabId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const inactiveCollabId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    collaboratorLookupRepo.items.push(
      {
        id: activeCollabId,
        companyId: companyA,
        name: "Carlos Barbero",
        specialty: "Barba y Corte",
        isActive: true,
      },
      {
        id: inactiveCollabId,
        companyId: companyA,
        name: "Pedro Inactivo",
        specialty: "Corte",
        isActive: false,
      },
    );

    await linksRepo.create(
      CollaboratorServiceEntity.create({
        companyId: companyA,
        collaboratorId: activeCollabId,
        serviceId: activeService.id,
        commissionPercentage: 45,
      }),
    );
    await linksRepo.create(
      CollaboratorServiceEntity.create({
        companyId: companyA,
        collaboratorId: inactiveCollabId,
        serviceId: activeService.id,
        commissionPercentage: 30,
      }),
    );

    const catalog = await useCase.execute(companyA);

    expect(catalog.company).toEqual({
      id: companyA,
      companyName: "Barbearia Norte",
      timezone: "America/Sao_Paulo",
    });
    expect(catalog.services).toHaveLength(2);

    const classic = catalog.services.find((item) => item.id === activeService.id);
    expect(classic).toEqual({
      id: activeService.id,
      name: "Corte Clásico",
      description: "Con tijera y máquina",
      durationMinutes: 45,
      priceInCents: 3500,
      collaborators: [
        {
          id: activeCollabId,
          name: "Carlos Barbero",
          specialty: "Barba y Corte",
        },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain("commissionPercentage");

    const wash = catalog.services.find((item) => item.id === serviceWithoutCollaborators.id);
    expect(wash?.collaborators).toEqual([]);
  });

  it("returns company info with an empty services list when an active company has no active services", async () => {
    const catalog = await useCase.execute(companyB);
    expect(catalog).toEqual({
      company: {
        id: companyB,
        companyName: "Salon Sur",
        timezone: "America/Caracas",
      },
      services: [],
    });
  });

  it("throws PublicCompanyNotFoundError for unknown or inactive companies", async () => {
    await expect(useCase.execute(unknownCompany)).rejects.toBeInstanceOf(
      PublicCompanyNotFoundError,
    );
    await expect(useCase.execute(inactiveCompany)).rejects.toBeInstanceOf(
      PublicCompanyNotFoundError,
    );
  });
});
