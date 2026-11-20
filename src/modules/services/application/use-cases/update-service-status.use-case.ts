import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  ServiceNotFoundError,
  UnauthorizedServiceActionError,
} from "../../domain/errors/service-errors.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import {
  type ServiceOutputDTO,
  type UpdateServiceStatusInputDTO,
  toServiceOutputDTO,
} from "../dtos/service.dtos.js";

export class UpdateServiceStatusUseCase {
  constructor(private readonly servicesRepository: ServicesRepository) {}

  async execute(
    actor: ActorContext,
    input: UpdateServiceStatusInputDTO,
  ): Promise<ServiceOutputDTO> {
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

    service.setActive(input.active);
    await this.servicesRepository.save(service);

    return toServiceOutputDTO(service);
  }
}
