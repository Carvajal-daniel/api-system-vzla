import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  ServiceNameAlreadyExistsError,
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import {
  type ServiceOutputDTO,
  type UpdateServiceInputDTO,
  toServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class UpdateServiceUseCase {
  constructor(private readonly servicesRepository: ServicesRepository) {}

  async execute(actor: ActorContext, input: UpdateServiceInputDTO): Promise<ServiceOutputDTO> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    const service = await this.servicesRepository.findByIdInCompany(
      input.serviceId,
      actor.companyId,
    );

    if (!service) {
      throw new ServiceNotFoundError();
    }

    service.update({
      name: input.name,
      description: input.description,
      durationMinutes: input.durationMinutes,
      priceInCents: input.priceInCents,
      imageUrl: input.imageUrl,
    });

    if (input.name !== undefined) {
      const existing = await this.servicesRepository.findByNormalizedNameInCompany(
        service.normalizedName,
        actor.companyId,
      );

      if (existing && existing.id !== service.id) {
        throw new ServiceNameAlreadyExistsError();
      }
    }

    await this.servicesRepository.save(service);

    return toServiceOutputDTO(service);
  }
}
