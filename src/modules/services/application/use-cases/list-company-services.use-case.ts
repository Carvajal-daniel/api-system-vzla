import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { UnauthorizedServiceActionError } from "../../domain/errors/service-errors.js";
import type { ServicesRepository } from "../../domain/repositories/services.repository.js";
import { type ServiceOutputDTO, toServiceOutputDTO } from "../dtos/service.dtos.js";

export class ListCompanyServicesUseCase {
  constructor(private readonly servicesRepository: ServicesRepository) {}

  async execute(actor: ActorContext): Promise<ServiceOutputDTO[]> {
    if (actor.role !== "OWNER") {
      throw new UnauthorizedServiceActionError();
    }

    const services = await this.servicesRepository.findAllByCompany(actor.companyId);

    return services.map(toServiceOutputDTO);
  }
}
