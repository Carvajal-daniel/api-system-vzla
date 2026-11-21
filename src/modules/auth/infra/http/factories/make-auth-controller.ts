import { BcryptPasswordHasher } from "../../../../../shared/cryptography/bcrypt-password-hasher.js";
import type { PasswordHasher } from "../../../../../shared/cryptography/password-hasher.js";
import type { TokenService } from "../../../application/ports/token-service.js";
import { GetAuthenticatedProfileUseCase } from "../../../application/use-cases/get-authenticated-profile.use-case.js";
import { LoginUseCase } from "../../../application/use-cases/login.use-case.js";
import { RegisterOwnerUseCase } from "../../../application/use-cases/register-owner.use-case.js";
import type { AuthIdentityRepository } from "../../../domain/repositories/auth-identity.repository.js";
import { JwtTokenService } from "../../cryptography/jwt-token-service.js";
import { DrizzleAuthIdentityRepository } from "../../database/repositories/drizzle-auth-identity.repository.js";
import { AuthController } from "../controllers/auth.controller.js";

export interface AuthControllerDependencies {
  readonly authIdentityRepository?: AuthIdentityRepository;
  readonly passwordHasher?: PasswordHasher;
  readonly tokenService?: TokenService;
}

export function makeAuthController(
  deps: AuthControllerDependencies = {},
): AuthController {
  const authIdentityRepository =
    deps.authIdentityRepository ?? new DrizzleAuthIdentityRepository();
  const passwordHasher = deps.passwordHasher ?? new BcryptPasswordHasher();
  const tokenService = deps.tokenService ?? new JwtTokenService();

  return new AuthController(
    new RegisterOwnerUseCase(authIdentityRepository, passwordHasher, tokenService),
    new LoginUseCase(authIdentityRepository, passwordHasher, tokenService),
    new GetAuthenticatedProfileUseCase(authIdentityRepository),
    authIdentityRepository,
    passwordHasher,
  );
}
