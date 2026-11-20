import { ServiceEntity } from "../../domain/entities/service.entity.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";

export class InMemoryServicesRepository implements ServicesRepository {
  public readonly items: ServiceEntity[] = [];

  private clone(entity: ServiceEntity): ServiceEntity {
    return ServiceEntity.restore({
      id: entity.id,
      companyId: entity.companyId,
      name: entity.name,
      description: entity.description,
      durationMinutes: entity.durationMinutes,
      priceInCents: entity.priceInCents,
      active: entity.active,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findByIdInCompany(id: string, companyId: string): Promise<ServiceEntity | null> {
    const found = this.items.find((item) => item.id === id && item.companyId === companyId);
    return found ? this.clone(found) : null;
  }

  async findByNormalizedNameInCompany(
    normalizedName: string,
    companyId: string,
  ): Promise<ServiceEntity | null> {
    const found = this.items.find(
      (item) => item.companyId === companyId && item.normalizedName === normalizedName,
    );
    return found ? this.clone(found) : null;
  }

  async findAllByCompany(companyId: string): Promise<ServiceEntity[]> {
    return this.items
      .filter((item) => item.companyId === companyId)
      .map((item) => this.clone(item));
  }

  async findActiveByCompany(companyId: string): Promise<ServiceEntity[]> {
    return this.items
      .filter((item) => item.companyId === companyId && item.active)
      .map((item) => this.clone(item));
  }

  async create(service: ServiceEntity): Promise<void> {
    this.items.push(this.clone(service));
  }

  async save(service: ServiceEntity): Promise<void> {
    const index = this.items.findIndex(
      (item) => item.id === service.id && item.companyId === service.companyId,
    );

    if (index >= 0) {
      this.items[index] = this.clone(service);
    }
  }
}
