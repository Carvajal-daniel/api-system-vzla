import { CompanyEntity } from '../domain/entities/company.entity.js';
import type { CompaniesRepository } from '../domain/repository/companies.repository.interface.js';
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
      timezone: data.timezone,
    });


    const emailExists = await this.companiesRepository.existsByEmail(data.email);
    if (emailExists) {
      throw new CompanyEmailAlreadyInError();
    }


    await this.companiesRepository.save(company, passwordHash);

    
    return {
      id: company.id,
      companyName: company.companyName,
      email: company.email,
      timezone: company.timezone,
    };
  }
}
