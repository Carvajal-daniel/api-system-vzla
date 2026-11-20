import { beforeEach, describe, expect, it } from "vitest";
import { CollaboratorServiceEntity } from "../../domain/entities/collaborator-service.entity.js";
import { ServiceEntity } from "../../domain/entities/service.entity.js";
import { ListPublicCompanyCatalogUseCase } from "../use-cases/list-public-company-catalog.use-case.js";
import { InMemoryCollaboratorLookupRepository } from "./in-memory-collaborator-lookup.repository.js";
import { InMemoryCollaboratorServicesRepository } from "./in-memory-collaborator-services.repository.js";
import { InMemoryServicesRepository } from "./in-memory-services.repository.js";

describe("Public Company Catalog Use Case (US5)", () => {
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";
  const unknownCompany = "99999999-9999-4999-8999-999999999999";

  let servicesRepo: InMemoryServicesRepository;
  let linksRepo: InMemoryCollaboratorServicesRepository;
  let collaboratorLookupRepo: InMemoryCollaboratorLookupRepository;
  let useCase: ListPublicCompanyCatalogUseCase;

  beforeEach(() => {
    servicesRepo = new InMemoryServicesRepository();
    linksRepo = new InMemoryCollaboratorServicesRepository();
    collaboratorLookupRepo = new InMemoryCollaboratorLookupRepository();
    useCase = new ListPublicCompanyCatalogUseCase(
      servicesRepo,
      linksRepo,
      collaboratorLookupRepo,
    );
  });

  it("returns only active services and active linked collaborators without exposing commissions or other companies", async () => {
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

    expect(catalog).toHaveLength(2);

    const classic = catalog.find((item) => item.id === activeService.id);
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

    const wash = catalog.find((item) => item.id === serviceWithoutCollaborators.id);
    expect(wash?.collaborators).toEqual([]);
  });

  it("returns an empty catalog for an unknown company or a company with no active services", async () => {
    const catalog = await useCase.execute(unknownCompany);
    expect(catalog).toEqual([]);
  });
});
