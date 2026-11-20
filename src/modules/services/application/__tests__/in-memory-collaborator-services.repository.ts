import { CollaboratorServiceEntity } from "../../domain/entities/collaborator-service.entity.js";
import type { CollaboratorServicesRepository } from "../../domain/repositories/collaborator-services.repository.js";

export class InMemoryCollaboratorServicesRepository implements CollaboratorServicesRepository {
  public readonly items: CollaboratorServiceEntity[] = [];

  private clone(entity: CollaboratorServiceEntity): CollaboratorServiceEntity {
    return CollaboratorServiceEntity.restore({
      id: entity.id,
      companyId: entity.companyId,
      collaboratorId: entity.collaboratorId,
      serviceId: entity.serviceId,
      commissionPercentage: entity.commissionPercentage,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  async findByCollaboratorAndServiceInCompany(
    collaboratorId: string,
    serviceId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity | null> {
    const found = this.items.find(
      (item) =>
        item.companyId === companyId &&
        item.collaboratorId === collaboratorId &&
        item.serviceId === serviceId,
    );
    return found ? this.clone(found) : null;
  }

  async findAllByCollaboratorInCompany(
    collaboratorId: string,
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]> {
    return this.items
      .filter((item) => item.companyId === companyId && item.collaboratorId === collaboratorId)
      .map((item) => this.clone(item));
  }

  async findAllByServiceIdsInCompany(
    serviceIds: string[],
    companyId: string,
  ): Promise<CollaboratorServiceEntity[]> {
    const idSet = new Set(serviceIds);
    return this.items
      .filter((item) => item.companyId === companyId && idSet.has(item.serviceId))
      .map((item) => this.clone(item));
  }

  async create(link: CollaboratorServiceEntity): Promise<void> {
    this.items.push(this.clone(link));
  }

  async save(link: CollaboratorServiceEntity): Promise<void> {
    const index = this.items.findIndex(
      (item) =>
        item.companyId === link.companyId &&
        item.collaboratorId === link.collaboratorId &&
        item.serviceId === link.serviceId,
    );

    if (index >= 0) {
      this.items[index] = this.clone(link);
    }
  }

  async delete(collaboratorId: string, serviceId: string, companyId: string): Promise<void> {
    const index = this.items.findIndex(
      (item) =>
        item.companyId === companyId &&
        item.collaboratorId === collaboratorId &&
        item.serviceId === serviceId,
    );

    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }
}
