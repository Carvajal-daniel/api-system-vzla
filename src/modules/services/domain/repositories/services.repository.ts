import type { ServiceEntity } from "../entities/service.entity.js";

export interface ServicesRepository {
  findByIdInCompany(id: string, companyId: string): Promise<ServiceEntity | null>;
  findByNormalizedNameInCompany(normalizedName: string, companyId: string): Promise<ServiceEntity | null>;
  findAllByCompany(companyId: string): Promise<ServiceEntity[]>;
  findActiveByCompany(companyId: string): Promise<ServiceEntity[]>;
  create(service: ServiceEntity): Promise<void>;
  save(service: ServiceEntity): Promise<void>;
}
