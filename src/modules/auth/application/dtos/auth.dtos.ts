import type { ActorRole } from "../../../../shared/auth/actor-context.js";

export interface RegisterOwnerInputDTO {
  readonly companyName: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string;
  readonly password: string;
  readonly timezone?: string | undefined;
}

export interface LoginInputDTO {
  readonly email: string;
  readonly password: string;
}

export interface AuthenticatedUserSummaryDTO {
  readonly id: string;
  readonly companyId: string;
  readonly role: ActorRole;
  readonly name: string;
  readonly email: string;
  readonly companyName: string;
}

export interface AuthTokenResponseDTO {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: string;
  readonly user: AuthenticatedUserSummaryDTO;
}

export interface OwnerProfileDTO {
  readonly role: "OWNER";
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly isActive: boolean;
  readonly company: {
    readonly id: string;
    readonly companyName: string;
    readonly isActive: boolean;
  };
}

export interface CollaboratorProfileDTO {
  readonly role: "COLLABORATOR";
  readonly id: string;
  readonly companyId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly specialty: string;
  readonly commissionPercentage: number;
  readonly isActive: boolean;
  readonly company: {
    readonly id: string;
    readonly companyName: string;
    readonly isActive: boolean;
  };
}

export type AuthenticatedProfileDTO = OwnerProfileDTO | CollaboratorProfileDTO;
