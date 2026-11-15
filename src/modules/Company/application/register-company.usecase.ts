import { NameVO } from '../domain/value-objects/name.value-object.js';
import { CompanyEntity, type CompanyProps } from '../domain/entities/company.entity.js';
import type { CompaniesRepository } from '../domain/repository/companies.repository.interface.js';
import { CompanyEmail } from '../domain/value-objects/company-email.vo.js';
import { Password } from '../domain/value-objects/password.vo.js';
import { CompanyEmailAlreadyInError } from '../domain/errors/email-already-exyst.js';
import type { RegisterCompanyInputDTO, RegisterCompanyOutputDTO } from './company-dto.js';
import type { PasswordHasher } from '../../../shared/cryptography/password-hasher.js';


export class RegisterCompanyUseCase {
  constructor(
    private readonly companiesRepository: CompaniesRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(data: RegisterCompanyInputDTO): Promise<RegisterCompanyOutputDTO> {
    

    const passwordVO = Password.create(data.password);
    const passwordHash = await this.passwordHasher.hash(passwordVO.value);


    const company = CompanyEntity.create({
      companyName: data.companyName,
      name: data.name,
      phone: data.phone,
      email: data.email,
      password: passwordHash,
    });


    const emailExists = await this.companiesRepository.existsByEmail(data.email);
    if (emailExists) {
      throw new CompanyEmailAlreadyInError();
    }


    await this.companiesRepository.save(company, passwordHash);

    
    return {
      id: company.id,
      companyName: company.companyName,
      email: company.email
    };
  }
}
