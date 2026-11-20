import type { CollaboratorServiceEntity } from "../../domain/entities/collaborator-service.entity.js";
import type { ServiceEntity } from "../../domain/entities/service.entity.js";

export interface ServiceOutputDTO {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInCents: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateServiceInputDTO {
  name: string;
  description?: string | null | undefined;
  durationMinutes: number;
  priceInCents: number;
}

export interface UpdateServiceInputDTO {
  serviceId: string;
  name?: string | undefined;
  description?: string | null | undefined;
  durationMinutes?: number | undefined;
  priceInCents?: number | undefined;
}

export interface UpdateServiceStatusInputDTO {
  serviceId: string;
  active: boolean;
}

export interface CollaboratorServiceOutputDTO {
  id: string;
  companyId: string;
  collaboratorId: string;
  serviceId: string;
  commissionPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LinkCollaboratorToServiceInputDTO {
  serviceId: string;
  collaboratorId: string;
  commissionPercentage: number;
}

export interface UpdateCollaboratorServiceCommissionInputDTO {
  serviceId: string;
  collaboratorId: string;
  commissionPercentage: number;
}

export interface UnlinkCollaboratorFromServiceInputDTO {
  serviceId: string;
  collaboratorId: string;
}

export interface CollaboratorAssignedServiceOutputDTO {
  serviceId: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInCents: number;
  active: boolean;
  commissionPercentage: number;
}

export interface ServiceCollaboratorOutputDTO {
  collaboratorId: string;
  name: string;
  specialty: string;
  isActive: boolean;
  commissionPercentage: number;
}

export interface PublicCatalogCollaboratorOutputDTO {
  id: string;
  name: string;
  specialty: string;
}

export interface PublicCatalogServiceOutputDTO {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInCents: number;
  collaborators: PublicCatalogCollaboratorOutputDTO[];
}

export interface PublicCompanyInfoDTO {
  id: string;
  companyName: string;
  timezone: string;
}

export interface PublicCompanyCatalogOutputDTO {
  company: PublicCompanyInfoDTO;
  services: PublicCatalogServiceOutputDTO[];
}

export function toServiceOutputDTO(service: ServiceEntity): ServiceOutputDTO {
  return {
    id: service.id,
    companyId: service.companyId,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    priceInCents: service.priceInCents,
    active: service.active,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export function toCollaboratorServiceOutputDTO(
  link: CollaboratorServiceEntity,
): CollaboratorServiceOutputDTO {
  return {
    id: link.id,
    companyId: link.companyId,
    collaboratorId: link.collaboratorId,
    serviceId: link.serviceId,
    commissionPercentage: link.commissionPercentage,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
