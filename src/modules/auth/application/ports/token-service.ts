import type { ActorRole } from "../../../../shared/auth/actor-context.js";

export interface AccessTokenPayload {
  readonly sub: string;
  readonly companyId: string;
  readonly role: ActorRole;
}

export interface SignedAccessToken {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: string;
}

export interface TokenService {
  signAccessToken(payload: AccessTokenPayload): SignedAccessToken;
}
