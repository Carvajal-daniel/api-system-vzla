import type {
  AuthCollaboratorRecord,
  AuthIdentityRecord,
  AuthIdentityRepository,
  AuthOwnerRecord,
  CreateOwnerCompanyRecord,
} from "../../domain/repositories/auth-identity.repository.js";

interface StoredCompany {
  id: string;
  companyName: string;
  name: string;
  phone: string;
  email: string;
  passwordHash: string;
  timezone?: string;
  isActive: boolean;
}

interface StoredCollaborator {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  email: string;
  passwordHash: string;
  specialty: string;
  commissionPercentage: number;
  isActive: boolean;
}

export class InMemoryAuthIdentityRepository implements AuthIdentityRepository {
  public readonly companies: StoredCompany[] = [];
  public readonly collaborators: StoredCollaborator[] = [];

  seedCompany(company: StoredCompany): void {
    this.companies.push({ ...company });
  }

  seedCollaborator(collaborator: StoredCollaborator): void {
    this.collaborators.push({ ...collaborator });
  }

  setCompanyActive(companyId: string, isActive: boolean): void {
    const company = this.companies.find((item) => item.id === companyId);
    if (company) {
      company.isActive = isActive;
    }
  }

  setCollaboratorActive(collaboratorId: string, isActive: boolean): void {
    const collaborator = this.collaborators.find((item) => item.id === collaboratorId);
    if (collaborator) {
      collaborator.isActive = isActive;
    }
  }

  async existsEmailInUse(email: string): Promise<boolean> {
    return (
      this.companies.some((company) => company.email === email) ||
      this.collaborators.some((collaborator) => collaborator.email === email)
    );
  }

  async createOwnerCompany(record: CreateOwnerCompanyRecord): Promise<void> {
    this.companies.push({
      id: record.id,
      companyName: record.companyName,
      name: record.name,
      phone: record.phone,
      email: record.email,
      passwordHash: record.passwordHash,
      timezone: record.timezone ?? "America/Sao_Paulo",
      isActive: record.isActive,
    });
  }

  async findByEmail(email: string): Promise<AuthIdentityRecord | null> {
    const company = this.companies.find((item) => item.email === email);
    if (company) {
      return {
        role: "OWNER",
        id: company.id,
        companyId: company.id,
        companyName: company.companyName,
        companyTimezone: company.timezone ?? "America/Sao_Paulo",
        name: company.name,
        phone: company.phone,
        email: company.email,
        passwordHash: company.passwordHash,
        isActive: company.isActive,
      };
    }

    const collaborator = this.collaborators.find((item) => item.email === email);
    if (!collaborator) {
      return null;
    }

    const parentCompany = this.companies.find((item) => item.id === collaborator.companyId);
    if (!parentCompany) {
      return null;
    }

    return {
      role: "COLLABORATOR",
      id: collaborator.id,
      companyId: collaborator.companyId,
      companyName: parentCompany.companyName,
      companyTimezone: parentCompany.timezone ?? "America/Sao_Paulo",
      companyIsActive: parentCompany.isActive,
      name: collaborator.name,
      phone: collaborator.phone,
      email: collaborator.email,
      passwordHash: collaborator.passwordHash,
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
    };
  }

  async findOwnerById(companyId: string): Promise<AuthOwnerRecord | null> {
    const company = this.companies.find((item) => item.id === companyId);
    if (!company) {
      return null;
    }

    return {
      role: "OWNER",
      id: company.id,
      companyId: company.id,
      companyName: company.companyName,
      companyTimezone: company.timezone ?? "America/Sao_Paulo",
      name: company.name,
      phone: company.phone,
      email: company.email,
      passwordHash: company.passwordHash,
      isActive: company.isActive,
    };
  }

  async findCollaboratorById(
    collaboratorId: string,
    companyId: string,
  ): Promise<AuthCollaboratorRecord | null> {
    const collaborator = this.collaborators.find(
      (item) => item.id === collaboratorId && item.companyId === companyId,
    );
    if (!collaborator) {
      return null;
    }

    const parentCompany = this.companies.find((item) => item.id === collaborator.companyId);
    if (!parentCompany) {
      return null;
    }

    return {
      role: "COLLABORATOR",
      id: collaborator.id,
      companyId: collaborator.companyId,
      companyName: parentCompany.companyName,
      companyTimezone: parentCompany.timezone ?? "America/Sao_Paulo",
      companyIsActive: parentCompany.isActive,
      name: collaborator.name,
      phone: collaborator.phone,
      email: collaborator.email,
      passwordHash: collaborator.passwordHash,
      specialty: collaborator.specialty,
      commissionPercentage: collaborator.commissionPercentage,
      isActive: collaborator.isActive,
    };
  }
}
