import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { ServiceEntity } from "../../domain/entities/service.entity.js";
import {
  ServiceNameAlreadyExistsError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import {
  type CreateServiceInputDTO,
  type ServiceOutputDTO,
  toServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class CreateServiceUseCase {
  constructor(private readonly servicesRepository: ServicesRepository) {}

  async execute(actor: ActorContext, input: CreateServiceInputDTO): Promise<ServiceOutputDTO> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    const service = ServiceEntity.create({
      companyId: actor.companyId,
      name: input.name,
      description: input.description,
      durationMinutes: input.durationMinutes,
      priceInCents: input.priceInCents,
    });

    const existing = await this.servicesRepository.findByNormalizedNameInCompany(
      service.normalizedName,
      actor.companyId,
    );

    if (existing) {
      throw new ServiceNameAlreadyExistsError();
    }

    await this.servicesRepository.create(service);

    return toServiceOutputDTO(service);
  }
}
