import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import {
  InactiveAccountError,
  InvalidCredentialsError,
} from "../../domain/errors/auth-errors.js";
import type { AuthIdentityRepository } from "../../domain/repositories/auth-identity.repository.js";
import type { AuthTokenResponseDTO, LoginInputDTO } from "../dtos/auth.dtos.js";
import type { TokenService } from "../ports/token-service.js";

export class LoginUseCase {
  constructor(
    private readonly authIdentityRepository: AuthIdentityRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: LoginInputDTO): Promise<AuthTokenResponseDTO> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const identity = await this.authIdentityRepository.findByEmail(normalizedEmail);

    if (!identity) {
      throw new InvalidCredentialsError();
    }

    // Compara a senha exata enviada pelo usuário sem normalização adicional para preservar credenciais existentes.
    const isPasswordValid = await this.passwordHasher.compare(
      input.password,
      identity.passwordHash,
    );

    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    // Só revela que a conta ou empresa está inativa após confirmar que a senha é válida.
    if (identity.role === "OWNER" && !identity.isActive) {
      throw new InactiveAccountError();
    }

    if (
      identity.role === "COLLABORATOR" &&
      (!identity.isActive || !identity.companyIsActive)
    ) {
      throw new InactiveAccountError();
    }

    const signedToken = this.tokenService.signAccessToken({
      sub: identity.id,
      companyId: identity.companyId,
      role: identity.role,
    });

    return {
      ...signedToken,
      user: {
        id: identity.id,
        companyId: identity.companyId,
        role: identity.role,
        name: identity.name,
        email: identity.email,
        companyName: identity.companyName,
      },
    };
  }
}
