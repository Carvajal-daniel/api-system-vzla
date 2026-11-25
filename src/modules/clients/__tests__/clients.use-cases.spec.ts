import { describe, expect, it } from "vitest";
import { CreateClientUseCase } from "../application/use-cases/create-client.use-case.js";
import { GetClientByIdUseCase } from "../application/use-cases/get-client-by-id.use-case.js";
import { ListClientsUseCase } from "../application/use-cases/list-clients.use-case.js";
import { UpdateClientUseCase } from "../application/use-cases/update-client.use-case.js";
import type { Client } from "../domain/entities/client.entity.js";
import {
  ClientNotFoundError,
  ClientPhoneAlreadyExistsError,
} from "../domain/errors/client-errors.js";
import type { ClientsRepository } from "../domain/repositories/clients.repository.js";

class InMemoryClientsRepository implements ClientsRepository {
  private readonly items = new Map<string, Client>();

  async listByCompany(companyId: string, search?: string): Promise<Client[]> {
    const query = search?.trim().toLowerCase();
    return Array.from(this.items.values()).filter((client) => {
      if (client.companyId !== companyId) return false;
      if (!query) return true;
      return (
        client.name.toLowerCase().includes(query) ||
        client.phone.toLowerCase().includes(query)
      );
    });
  }

  async findById(companyId: string, id: string): Promise<Client | null> {
    const found = this.items.get(id);
    return found && found.companyId === companyId ? found : null;
  }

  async findByPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<Client | null> {
    for (const client of this.items.values()) {
      if (client.companyId === companyId && client.phone === normalizedPhone) {
        return client;
      }
    }
    return null;
  }

  async create(client: Client): Promise<Client> {
    this.items.set(client.id, client);
    return client;
  }

  async update(client: Client): Promise<Client> {
    this.items.set(client.id, client);
    return client;
  }
}

describe("Clients Hexagonal Use Cases (multi-tenant)", () => {
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";

  it("normalizes phone via Phone VO, prevents duplicate phone per company, and isolates tenants", async () => {
    const repo = new InMemoryClientsRepository();
    const createClient = new CreateClientUseCase(repo);
    const listClients = new ListClientsUseCase(repo);
    const getClientById = new GetClientByIdUseCase(repo);
    const updateClient = new UpdateClientUseCase(repo);

    const createdA = await createClient.execute({
      companyId: companyA,
      name: "Carlos Eduardo",
      phone: "+55 (11) 98765-4321",
      email: "Carlos@Example.com",
      tags: ["VIP", "vip"],
    });

    expect(createdA.phone).toBe("+5511987654321");
    expect(createdA.email).toBe("carlos@example.com");
    expect(createdA.tags).toEqual(["vip"]);

    // Mesmo telefone na mesma empresa deve falhar com conflito
    await expect(
      createClient.execute({
        companyId: companyA,
        name: "Outro Carlos",
        phone: "+55 11 98765-4321",
      }),
    ).rejects.toBeInstanceOf(ClientPhoneAlreadyExistsError);

    // Mesmo telefone em outra empresa é permitido (isolamento multi-tenant)
    const createdB = await createClient.execute({
      companyId: companyB,
      name: "Carlos Empresa B",
      phone: "+5511987654321",
    });

    expect(createdB.companyId).toBe(companyB);
    expect((await listClients.execute(companyA)).length).toBe(1);
    expect((await listClients.execute(companyB)).length).toBe(1);

    // Empresa B não pode acessar cliente da Empresa A
    await expect(
      getClientById.execute(companyB, createdA.id),
    ).rejects.toBeInstanceOf(ClientNotFoundError);

    // Atualização de cliente na empresa proprietária
    const updatedA = await updateClient.execute({
      companyId: companyA,
      id: createdA.id,
      notes: "Prefere corte degradê navalhado.",
      tags: ["vip", "recorrente"],
    });

    expect(updatedA.notes).toBe("Prefere corte degradê navalhado.");
    expect(updatedA.tags).toEqual(["vip", "recorrente"]);
  });
});
