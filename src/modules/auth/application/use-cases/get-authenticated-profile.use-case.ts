import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { isSuperAdminEmail } from "../../../../shared/http/auth/authenticate.js";
import { AuthenticatedActorNotFoundError } from "../../domain/errors/auth-errors.js";
import type { AuthIdentityRepository } from "../../domain/repositories/auth-identity.repository.js";
import type { AuthenticatedProfileDTO } from "../dtos/auth.dtos.js";

export class GetAuthenticatedProfileUseCase {
  constructor(private readonly authIdentityRepository: AuthIdentityRepository) {}

  async execute(actor: ActorContext): Promise<AuthenticatedProfileDTO> {
    if (actor.role === "OWNER") {
      const owner = await this.authIdentityRepository.findOwnerById(actor.companyId);

      if (!owner || !owner.isActive) {
        throw new AuthenticatedActorNotFoundError();
      }

      return {
        role: "OWNER",
        id: owner.id,
        companyId: owner.companyId,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        avatarUrl: owner.avatarUrl ?? null,
        isActive: owner.isActive,
        isSuperAdmin: isSuperAdminEmail(owner.email),
        company: {
          id: owner.companyId,
          companyName: owner.companyName,
          timezone: owner.companyTimezone,
          currency: owner.companyCurrency ?? "BRL",
          isActive: owner.isActive,
          avatarUrl: owner.avatarUrl ?? null,
          operatingDays: owner.operatingDays ?? null,
          operatingSchedule: owner.operatingSchedule ?? null,
        },
      };
    }

    const collaborator = await this.authIdentityRepository.findCollaboratorById(
      actor.collaboratorId,
      actor.companyId,
    );

    if (!collaborator || !collaborator.isActive || !collaborator.companyIsActive) {
      throw new AuthenticatedActorNotFoundError();
    }

    return {
      role: "COLLABORATOR",
      id: collaborator.id,
      companyId: collaborator.companyId,
      name: collaborator.name,
      email: collaborator.email,
      phone: collaborator.phone,
      avatarUrl: collaborator.avatarUrl ?? null,
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
      company: {
        id: collaborator.companyId,
        companyName: collaborator.companyName,
        timezone: collaborator.companyTimezone,
          currency: collaborator.companyCurrency ?? "BRL",
        isActive: collaborator.companyIsActive,
        avatarUrl: collaborator.companyAvatarUrl ?? null,
        operatingDays: collaborator.companyOperatingDays ?? null,
        operatingSchedule: collaborator.companyOperatingSchedule ?? null,
      },
    };
  }
}
