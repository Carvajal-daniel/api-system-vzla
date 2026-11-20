import type {
  CompanyLookupRepository,
  PublicCompanySummary,
} from "../../domain/repositories/company-lookup.repository.js";

export class InMemoryCompanyLookupRepository implements CompanyLookupRepository {
  public readonly items: PublicCompanySummary[] = [];

  seed(company: PublicCompanySummary): void {
    this.items.push({ ...company });
  }

  async findById(companyId: string): Promise<PublicCompanySummary | null> {
    const found = this.items.find((item) => item.id === companyId);
    return found ? { ...found } : null;
  }
}
