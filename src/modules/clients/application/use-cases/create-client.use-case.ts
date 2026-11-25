import {
  Client,
  type CreateClientParams,
} from "../../domain/entities/client.entity.js";
import { ClientPhoneAlreadyExistsError } from "../../domain/errors/client-errors.js";
import type { ClientsRepository } from "../../domain/repositories/clients.repository.js";

export class CreateClientUseCase {
  constructor(private readonly repository: ClientsRepository) {}

  async execute(params: CreateClientParams) {
    const client = Client.create(params);
    const existing = await this.repository.findByPhone(
      params.companyId,
      client.phone,
    );

    if (existing) {
      throw new ClientPhoneAlreadyExistsError();
    }

    const saved = await this.repository.create(client);
    return saved.toDTO();
  }
}
