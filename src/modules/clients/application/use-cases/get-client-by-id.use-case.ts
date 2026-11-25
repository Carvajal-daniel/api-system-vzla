import { ClientNotFoundError } from "../../domain/errors/client-errors.js";
import type { ClientsRepository } from "../../domain/repositories/clients.repository.js";

export class GetClientByIdUseCase {
  constructor(private readonly repository: ClientsRepository) {}

  async execute(companyId: string, id: string) {
    const client = await this.repository.findById(companyId, id);
    if (!client) {
      throw new ClientNotFoundError();
    }
    return client.toDTO();
  }
}
