import type { Client } from "../entities/client.entity.js";

export interface ClientsRepository {
  listByCompany(companyId: string, search?: string): Promise<Client[]>;
  findById(companyId: string, id: string): Promise<Client | null>;
  findByPhone(companyId: string, normalizedPhone: string): Promise<Client | null>;
  create(client: Client): Promise<Client>;
  update(client: Client): Promise<Client>;
}
