import type { PasswordHasher } from "../../../../shared/cryptography/password-hasher.js";
import { CompanyEntity } from "../../../Company/domain/entities/company.entity.js";
import { Password } from "../../../Company/domain/value-objects/password.vo.js";
import { AuthEmailAlreadyInUseError } from "../../domain/errors/auth-errors.js";
import type { AuthIdentityRepository } from "../../domain/repositories/auth-identity.repository.js";
import type { AuthTokenResponseDTO, RegisterOwnerInputDTO } from "../dtos/auth.dtos.js";
import type { TokenService } from "../ports/token-service.js";

export class RegisterOwnerUseCase {
  constructor(
    private readonly authIdentityRepository: AuthIdentityRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: RegisterOwnerInputDTO): Promise<AuthTokenResponseDTO> {
    const normalizedEmail = input.email.trim().toLowerCase();

    // Verifica unicidade global entre empresas e colaboradores para evitar ambiguidade no login por e-mail.
    const emailInUse = await this.authIdentityRepository.existsEmailInUse(normalizedEmail);
    if (emailInUse) {
      throw new AuthEmailAlreadyInUseError();
    }

    // Reutiliza a política de senha já estabelecida no domínio de Company.
    const passwordVO = Password.create(input.password);
    const passwordHash = await this.passwordHasher.hash(passwordVO.value);

    const company = CompanyEntity.create({
      companyName: input.companyName.trim(),
      name: input.name.trim(),
      phone: input.phone.trim(),
      email: normalizedEmail,
      password: passwordHash,
      timezone: input.timezone,
    });

    await this.authIdentityRepository.createOwnerCompany({
      id: company.id,
      companyName: company.companyName,
      name: company.name,
      phone: company.phone,
      email: company.email,
      passwordHash,
      isActive: company.isActive,
      timezone: company.timezone,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    });

    const signedToken = this.tokenService.signAccessToken({
      sub: company.id,
      companyId: company.id,
      role: "OWNER",
    });

    return {
      ...signedToken,
      user: {
        id: company.id,
        companyId: company.id,
        role: "OWNER",
        name: company.name,
        email: company.email,
        companyName: company.companyName,
      },
    };
  }
}
