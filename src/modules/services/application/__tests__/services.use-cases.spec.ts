import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  InvalidServiceDurationError,
  InvalidServiceNameError,
  InvalidServicePriceError,
  ServiceNameAlreadyExistsError,
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import { CreateServiceUseCase } from "../use-cases/create-service.use-case.js";
import { ListCompanyServicesUseCase } from "../use-cases/list-company-services.use-case.js";
import { UpdateServiceStatusUseCase } from "../use-cases/update-service-status.use-case.js";
import { UpdateServiceUseCase } from "../use-cases/update-service.use-case.js";
import { InMemoryServicesRepository } from "./in-memory-services.repository.js";

describe("Services Use Cases (US1)", () => {
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

  const collaboratorA: ActorContext = {
    role: "COLLABORATOR",
    collaboratorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    companyId: companyA,
  };

  let repository: InMemoryServicesRepository;
  let createService: CreateServiceUseCase;
  let listServices: ListCompanyServicesUseCase;
  let updateService: UpdateServiceUseCase;
  let updateStatus: UpdateServiceStatusUseCase;

  beforeEach(() => {
    repository = new InMemoryServicesRepository();
    createService = new CreateServiceUseCase(repository);
    listServices = new ListCompanyServicesUseCase(repository);
    updateService = new UpdateServiceUseCase(repository);
    updateStatus = new UpdateServiceStatusUseCase(repository);
  });

  it("creates an active service scoped to the owner's company", async () => {
    const created = await createService.execute(ownerA, {
      name: "  Corte Clásico  ",
      description: "Corte tradicional",
      durationMinutes: 45,
      priceInCents: 3500,
    });

    expect(created.id).toBeTruthy();
    expect(created.companyId).toBe(companyA);
    expect(created.name).toBe("Corte Clásico");
    expect(created.description).toBe("Corte tradicional");
    expect(created.durationMinutes).toBe(45);
    expect(created.priceInCents).toBe(3500);
    expect(created.active).toBe(true);
    expect(repository.items).toHaveLength(1);
  });

  it("accepts a free service with priceInCents = 0", async () => {
    const created = await createService.execute(ownerA, {
      name: "Evaluación Capilar",
      durationMinutes: 15,
      priceInCents: 0,
    });

    expect(created.priceInCents).toBe(0);
    expect(created.description).toBeNull();
  });

  it("rejects duplicate normalized names within the same company, but allows same name in another company", async () => {
    await createService.execute(ownerA, {
      name: "Corte Clásico",
      durationMinutes: 45,
      priceInCents: 3500,
    });

    await expect(
      createService.execute(ownerA, {
        name: "  corte clásico  ",
        durationMinutes: 30,
        priceInCents: 3000,
      }),
    ).rejects.toBeInstanceOf(ServiceNameAlreadyExistsError);

    const companyBService = await createService.execute(ownerB, {
      name: "Corte Clásico",
      durationMinutes: 45,
      priceInCents: 4000,
    });

    expect(companyBService.companyId).toBe(companyB);
    expect(repository.items).toHaveLength(2);
  });

  it("rejects invalid name, duration <= 0, and price < 0 before persisting", async () => {
    await expect(
      createService.execute(ownerA, {
        name: "   ",
        durationMinutes: 30,
        priceInCents: 2000,
      }),
    ).rejects.toBeInstanceOf(InvalidServiceNameError);

    await expect(
      createService.execute(ownerA, {
        name: "Barba",
        durationMinutes: 0,
        priceInCents: 2000,
      }),
    ).rejects.toBeInstanceOf(InvalidServiceDurationError);

    await expect(
      createService.execute(ownerA, {
        name: "Barba",
        durationMinutes: -10,
        priceInCents: 2000,
      }),
    ).rejects.toBeInstanceOf(InvalidServiceDurationError);

    await expect(
      createService.execute(ownerA, {
        name: "Barba",
        durationMinutes: 30,
        priceInCents: -1,
      }),
    ).rejects.toBeInstanceOf(InvalidServicePriceError);

    expect(repository.items).toHaveLength(0);
  });

  it("lists both active and inactive services for the owner's company only", async () => {
    const s1 = await createService.execute(ownerA, {
      name: "Corte",
      durationMinutes: 30,
      priceInCents: 2500,
    });
    await createService.execute(ownerB, {
      name: "Peinado B",
      durationMinutes: 60,
      priceInCents: 5000,
    });
    await updateStatus.execute(ownerA, { serviceId: s1.id, active: false });

    const servicesA = await listServices.execute(ownerA);

    expect(servicesA).toHaveLength(1);
    expect(servicesA[0]?.id).toBe(s1.id);
    expect(servicesA[0]?.active).toBe(false);
  });

  it("updates service attributes and prevents normalized name collisions", async () => {
    const s1 = await createService.execute(ownerA, {
      name: "Corte",
      durationMinutes: 30,
      priceInCents: 2500,
    });
    await createService.execute(ownerA, {
      name: "Barba",
      durationMinutes: 20,
      priceInCents: 1500,
    });

    const updated = await updateService.execute(ownerA, {
      serviceId: s1.id,
      name: "Corte Premium",
      durationMinutes: 50,
      priceInCents: 4500,
    });

    expect(updated.name).toBe("Corte Premium");
    expect(updated.durationMinutes).toBe(50);
    expect(updated.priceInCents).toBe(4500);

    await expect(
      updateService.execute(ownerA, {
        serviceId: s1.id,
        name: "  BARBA ",
      }),
    ).rejects.toBeInstanceOf(ServiceNameAlreadyExistsError);
  });

  it("blocks cross-company edits and status changes without revealing data", async () => {
    const sB = await createService.execute(ownerB, {
      name: "Coloración",
      durationMinutes: 90,
      priceInCents: 9000,
    });

    await expect(
      updateService.execute(ownerA, {
        serviceId: sB.id,
        priceInCents: 100,
      }),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);

    await expect(
      updateStatus.execute(ownerA, {
        serviceId: sB.id,
        active: false,
      }),
    ).rejects.toBeInstanceOf(ServiceNotFoundError);

    const servicesB = await listServices.execute(ownerB);
    expect(servicesB[0]?.priceInCents).toBe(9000);
    expect(servicesB[0]?.active).toBe(true);
  });

  it("rejects all service management operations when called by a COLLABORATOR", async () => {
    const sA = await createService.execute(ownerA, {
      name: "Corte",
      durationMinutes: 30,
      priceInCents: 2500,
    });

    await expect(
      createService.execute(collaboratorA, {
        name: "Barba",
        durationMinutes: 20,
        priceInCents: 1500,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);

    await expect(listServices.execute(collaboratorA)).rejects.toBeInstanceOf(
      UnauthorizedServiceActionError,
    );

    await expect(
      updateService.execute(collaboratorA, { serviceId: sA.id, priceInCents: 3000 }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);

    await expect(
      updateStatus.execute(collaboratorA, { serviceId: sA.id, active: false }),
    ).rejects.toBeInstanceOf(UnauthorizedServiceActionError);
  });
});
