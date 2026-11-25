import type { ClientsRepository } from "../../domain/repositories/clients.repository.js";

export class ListClientsUseCase {
  constructor(private readonly repository: ClientsRepository) {}

  async execute(companyId: string, search?: string) {
    const clients = await this.repository.listByCompany(companyId, search);
    return clients.map((client) => client.toDTO());
  }
}
