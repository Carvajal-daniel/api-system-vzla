import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { ServiceEntity } from "../../domain/entities/service.entity.js";
import {
  CollaboratorNotFoundError,
  CollaboratorServiceAlreadyExistsError,
  CollaboratorServiceNotFoundError,
  InvalidCommissionPercentageError,
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import { LinkCollaboratorToServiceUseCase } from "../use-cases/link-collaborator-to-service.use-case.js";
import { ListCollaboratorAssignedServicesUseCase } from "../use-cases/list-collaborator-assigned-services.use-case.js";
import { ListServiceCollaboratorsUseCase } from "../use-cases/list-service-collaborators.use-case.js";
import { UnlinkCollaboratorFromServiceUseCase } from "../use-cases/unlink-collaborator-from-service.use-case.js";
import { UpdateCollaboratorServiceCommissionUseCase } from "../use-cases/update-collaborator-service-commission.use-case.js";
import { InMemoryCollaboratorLookupRepository } from "./in-memory-collaborator-lookup.repository.js";
import { InMemoryCollaboratorServicesRepository } from "./in-memory-collaborator-services.repository.js";
import { InMemoryServicesRepository } from "./in-memory-services.repository.js";

describe("Collaborator-Services & Commissions Use Cases (US2)", () => {
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";

  const ownerA: ActorContext = {
    role: "OWNER",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: companyA,
  };

  const ownerB: ActorContext = {
    role: "OWNER",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    companyId: companyB,
  };

  const collaboratorActorA: ActorContext = {
    role: "COLLABORATOR",
    collaboratorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    companyId: companyA,
  };

  const activeCollabAId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const inactiveCollabAId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const activeCollabBId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  let servicesRepo: InMemoryServicesRepository;
  let collaboratorLookupRepo: InMemoryCollaboratorLookupRepository;
  let linksRepo: InMemoryCollaboratorServicesRepository;
  let linkUseCase: LinkCollaboratorToServiceUseCase;
  let updateCommissionUseCase: UpdateCollaboratorServiceCommissionUseCase;
  let unlinkUseCase: UnlinkCollaboratorFromServiceUseCase;

  let serviceA: ServiceEntity;
  let serviceB: ServiceEntity;

  beforeEach(async () => {
    servicesRepo = new InMemoryServicesRepository();
    collaboratorLookupRepo = new InMemoryCollaboratorLookupRepository();
    linksRepo = new InMemoryCollaboratorServicesRepository();

    linkUseCase = new LinkCollaboratorToServiceUseCase(
      servicesRepo,
      collaboratorLookupRepo,
      linksRepo,
    );
    updateCommissionUseCase = new UpdateCollaboratorServiceCommissionUseCase(linksRepo);
    unlinkUseCase = new UnlinkCollaboratorFromServiceUseCase(linksRepo);

    serviceA = ServiceEntity.create({
      companyId: companyA,
      name: "Corte Clásico",
      durationMinutes: 45,
      priceInCents: 3500,
    });
    serviceB = ServiceEntity.create({
      companyId: companyB,
      name: "Corte Empresa B",
      durationMinutes: 30,
      priceInCents: 3000,
    });

    await servicesRepo.create(serviceA);
    await servicesRepo.create(serviceB);

    collaboratorLookupRepo.items.push(
      {
        id: activeCollabAId,
        companyId: companyA,
        name: "Carlos Barbero",
        specialty: "Barba y Corte",
        isActive: true,
      },
      {
        id: inactiveCollabAId,
        companyId: companyA,
        name: "Pedro Inactivo",
        specialty: "Corte",
        isActive: false,
      },
      {
        id: activeCollabBId,
        companyId: companyB,
        name: "Luis Empresa B",
        specialty: "Color",
        isActive: true,
      },
    );
  });

  it("links an active collaborator to a service with valid commission including 0, 100 and decimals", async () => {
    const linked = await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 35.5,
    });

    expect(linked.companyId).toBe(companyA);
    expect(linked.serviceId).toBe(serviceA.id);
    expect(linked.collaboratorId).toBe(activeCollabAId);
    expect(linked.commissionPercentage).toBe(35.5);

    const updatedZero = await updateCommissionUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 0,
    });
    expect(updatedZero.commissionPercentage).toBe(0);

    const updatedHundred = await updateCommissionUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 100,
    });
    expect(updatedHundred.commissionPercentage).toBe(100);
  });

  it("rejects commissions outside 0..100 or with more than 2 decimal places before persisting", async () => {
    for (const invalid of [-0.01, -1, 100.01, 150, 33.333, Number.NaN]) {
      await expect(
        linkUseCase.execute(ownerA, {
          serviceId: serviceA.id,
          collaboratorId: activeCollabAId,
          commissionPercentage: invalid,
        }),
      ).rejects.toBeInstanceOf(InvalidCommissionPercentageError);
    }

    expect(linksRepo.items).toHaveLength(0);
  });

  it("rejects duplicate collaborator-service links in the same company", async () => {
    await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 40,
    });

    await expect(
      linkUseCase.execute(ownerA, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
        commissionPercentage: 50,
      }),
    ).rejects.toBeInstanceOf(CollaboratorServiceAlreadyExistsError);
  });

  it("rejects linking an inactive collaborator (isActive: false)", async () => {
    await expect(
      linkUseCase.execute(ownerA, {
        serviceId: serviceA.id,
        collaboratorId: inactiveCollabAId,
        commissionPercentage: 40,
      }),
    ).rejects.toBeInstanceOf(CollaboratorNotFoundError);

    expect(linksRepo.items).toHaveLength(0);
  });

  it("blocks cross-company linking, commission updates, and unlinking", async () => {
    await expect(
      linkUseCase.execute(ownerA, {
        serviceId: serviceB.id,
        collaboratorId: activeCollabAId,
        commissionPercentage: 40,
      }),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);

    await expect(
      linkUseCase.execute(ownerA, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabBId,
        commissionPercentage: 40,
      }),
    ).rejects.toBeInstanceOf(CollaboratorNotFoundError);

    await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 40,
    });

    await expect(
      updateCommissionUseCase.execute(ownerB, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
        commissionPercentage: 90,
      }),
    ).rejects.toBeInstanceOf(CollaboratorServiceNotFoundError);

    await expect(
      unlinkUseCase.execute(ownerB, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
      }),
    ).rejects.toBeInstanceOf(CollaboratorServiceNotFoundError);
  });

  it("unlinks an existing collaborator from a service", async () => {
    await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 40,
    });

    await unlinkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
    });

    expect(linksRepo.items).toHaveLength(0);
  });

  it("rejects all commission and link mutations when called by a COLLABORATOR", async () => {
    await expect(
      linkUseCase.execute(collaboratorActorA, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
        commissionPercentage: 50,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);

    await expect(
      updateCommissionUseCase.execute(collaboratorActorA, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
        commissionPercentage: 80,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);

    await expect(
      unlinkUseCase.execute(collaboratorActorA, {
        serviceId: serviceA.id,
        collaboratorId: activeCollabAId,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);
  });

  it("allows a COLLABORATOR to list only their own assigned services and commissions (US4)", async () => {
    const secondCollabAId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const serviceA2 = ServiceEntity.create({
      companyId: companyA,
      name: "Barba Completa",
      durationMinutes: 30,
      priceInCents: 2000,
    });
    await servicesRepo.create(serviceA2);
    collaboratorLookupRepo.items.push({
      id: secondCollabAId,
      companyId: companyA,
      name: "Mateo Barbero",
      specialty: "Barba",
      isActive: true,
    });

    await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 45,
    });
    await linkUseCase.execute(ownerA, {
      serviceId: serviceA2.id,
      collaboratorId: secondCollabAId,
      commissionPercentage: 60,
    });

    const listAssignedUseCase = new ListCollaboratorAssignedServicesUseCase(
      servicesRepo,
      linksRepo,
    );

    const ownServices = await listAssignedUseCase.execute(collaboratorActorA);

    expect(ownServices).toHaveLength(1);
    expect(ownServices[0]).toMatchObject({
      serviceId: serviceA.id,
      name: "Corte Clásico",
      commissionPercentage: 45,
    });

    await expect(listAssignedUseCase.execute(ownerA)).rejects.toBeInstanceOf(
      UnauthorizedServiceActionError,
    );
  });

  it("allows an OWNER to list collaborators linked to their service, enforcing tenant isolation and RBAC", async () => {
    await linkUseCase.execute(ownerA, {
      serviceId: serviceA.id,
      collaboratorId: activeCollabAId,
      commissionPercentage: 45,
    });

    const listServiceCollaboratorsUseCase = new ListServiceCollaboratorsUseCase(
      servicesRepo,
      linksRepo,
      collaboratorLookupRepo,
    );

    const linked = await listServiceCollaboratorsUseCase.execute(ownerA, serviceA.id);
    expect(linked).toEqual([
      {
        collaboratorId: activeCollabAId,
        name: "Carlos Barbero",
        specialty: "Barba y Corte",
        isActive: true,
        commissionPercentage: 45,
      },
    ]);

    await expect(
      listServiceCollaboratorsUseCase.execute(ownerB, serviceA.id),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);

    await expect(
      listServiceCollaboratorsUseCase.execute(collaboratorActorA, serviceA.id),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);
  });
});
