import type {
  ActiveCompanyContext,
  ActiveServiceContext,
  EnabledCollaboratorForServiceContext,
  SchedulingContextLookupRepository,
} from "../../domain/repositories/scheduling-context-lookup.repository.js";
import type { DailyWorkScheduleData } from "../../domain/services/availability-calculator.js";

export class InMemorySchedulingContextLookupRepository
  implements SchedulingContextLookupRepository
{
  public readonly companies = new Map<string, ActiveCompanyContext>();
  public readonly services = new Map<string, ActiveServiceContext>();
  public readonly collaborators = new Map<
    string,
    { id: string; companyId: string; name: string; isActive: boolean }
  >();
  // Chave: `${companyId}:${serviceId}:${collaboratorId}`
  public readonly links = new Map<string, { commissionPercentage: number }>();
  // Chave: `${companyId}:${collaboratorId}:${dayOfWeek}`
  public readonly workSchedules = new Map<string, DailyWorkScheduleData>();

  addCompany(company: ActiveCompanyContext): void {
    this.companies.set(company.id, company);
  }

  addService(service: ActiveServiceContext): void {
    this.services.set(service.id, service);
  }

  addCollaborator(collaborator: {
    id: string;
    companyId: string;
    name: string;
    isActive: boolean;
  }): void {
    this.collaborators.set(collaborator.id, collaborator);
  }

  linkCollaboratorToService(
    companyId: string,
    serviceId: string,
    collaboratorId: string,
    commissionPercentage: number,
  ): void {
    this.links.set(`${companyId}:${serviceId}:${collaboratorId}`, {
      commissionPercentage,
    });
  }

  setWorkSchedule(
    companyId: string,
    collaboratorId: string,
    schedule: DailyWorkScheduleData,
  ): void {
    this.workSchedules.set(
      `${companyId}:${collaboratorId}:${schedule.dayOfWeek}`,
      schedule,
    );
  }

  async findCompanyById(
    companyId: string,
  ): Promise<ActiveCompanyContext | null> {
    return this.companies.get(companyId) ?? null;
  }

  async findServiceById(
    companyId: string,
    serviceId: string,
  ): Promise<ActiveServiceContext | null> {
    const service = this.services.get(serviceId);
    if (!service || service.companyId !== companyId) return null;
    return service;
  }

  async findCollaboratorInCompany(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ id: string; name: string; isActive: boolean } | null> {
    const collab = this.collaborators.get(collaboratorId);
    if (!collab || collab.companyId !== companyId) return null;
    return { id: collab.id, name: collab.name, isActive: collab.isActive };
  }

  async findEnabledCollaboratorForService(
    companyId: string,
    serviceId: string,
    collaboratorId: string,
  ): Promise<EnabledCollaboratorForServiceContext | null> {
    const collab = this.collaborators.get(collaboratorId);
    if (!collab || collab.companyId !== companyId) return null;

    const link = this.links.get(`${companyId}:${serviceId}:${collaboratorId}`);
    if (!link) return null;

    return {
      collaboratorId: collab.id,
      collaboratorName: collab.name,
      commissionPercentage: link.commissionPercentage,
      isActive: collab.isActive,
    };
  }

  async listEnabledActiveCollaboratorsForService(
    companyId: string,
    serviceId: string,
  ): Promise<EnabledCollaboratorForServiceContext[]> {
    const results: EnabledCollaboratorForServiceContext[] = [];

    for (const collab of this.collaborators.values()) {
      if (collab.companyId !== companyId || !collab.isActive) continue;
      const link = this.links.get(`${companyId}:${serviceId}:${collab.id}`);
      if (!link) continue;

      results.push({
        collaboratorId: collab.id,
        collaboratorName: collab.name,
        commissionPercentage: link.commissionPercentage,
        isActive: collab.isActive,
      });
    }

    return results;
  }

  async findWorkScheduleForDay(
    companyId: string,
    collaboratorId: string,
    dayOfWeek: number,
  ): Promise<DailyWorkScheduleData | null> {
    return (
      this.workSchedules.get(
        `${companyId}:${collaboratorId}:${dayOfWeek}`,
      ) ?? null
    );
  }
}
