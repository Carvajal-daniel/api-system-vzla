import type { UpdateClientParams } from "../../domain/entities/client.entity.js";
import {
  ClientNotFoundError,
  ClientPhoneAlreadyExistsError,
} from "../../domain/errors/client-errors.js";
import type { ClientsRepository } from "../../domain/repositories/clients.repository.js";

export interface UpdateClientInput extends UpdateClientParams {
  companyId: string;
  id: string;
}

export class UpdateClientUseCase {
  constructor(private readonly repository: ClientsRepository) {}

  async execute(input: UpdateClientInput) {
    const existing = await this.repository.findById(input.companyId, input.id);
    if (!existing) {
      throw new ClientNotFoundError();
    }

    const updated = existing.update({
      name: input.name,
      phone: input.phone,
      email: input.email,
      birthDate: input.birthDate,
      tags: input.tags,
      notes: input.notes,
    });

    if (updated.phone !== existing.phone) {
      const conflict = await this.repository.findByPhone(
        input.companyId,
        updated.phone,
      );
      if (conflict && conflict.id !== existing.id) {
        throw new ClientPhoneAlreadyExistsError();
      }
    }

    const saved = await this.repository.update(updated);
    return saved.toDTO();
  }
}
