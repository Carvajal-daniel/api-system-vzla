import { and, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorServiceTable } from "../../../../services/infra/database/schema/collaborator-services-schema.js";
import { ServiceTable } from "../../../../services/infra/database/schema/services-schema.js";
import { WorkScheduleTable } from "../../../../work-schedules/infra/database/schema/work-schedules-schema.js";
import type {
  ActiveCompanyContext,
  ActiveServiceContext,
  EnabledCollaboratorForServiceContext,
  SchedulingContextLookupRepository,
} from "../../../domain/repositories/scheduling-context-lookup.repository.js";
import type { DailyWorkScheduleData } from "../../../domain/services/availability-calculator.js";

export class DrizzleSchedulingContextLookupRepository
  implements SchedulingContextLookupRepository
{
  async findCompanyById(
    companyId: string,
  ): Promise<ActiveCompanyContext | null> {
    const rows = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        timezone: CompanyTable.timezone,
        isActive: CompanyTable.isActive,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return rows[0] ?? null;
  }

  async findServiceById(
    companyId: string,
    serviceId: string,
  ): Promise<ActiveServiceContext | null> {
    const rows = await db
      .select({
        id: ServiceTable.id,
        companyId: ServiceTable.companyId,
        name: ServiceTable.name,
        durationMinutes: ServiceTable.durationMinutes,
        priceInCents: ServiceTable.priceInCents,
        active: ServiceTable.active,
      })
      .from(ServiceTable)
      .where(
        and(
          eq(ServiceTable.companyId, companyId),
          eq(ServiceTable.id, serviceId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findCollaboratorInCompany(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ id: string; name: string; isActive: boolean } | null> {
    const rows = await db
      .select({
        id: CollaboratorTable.id,
        name: CollaboratorTable.name,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.id, collaboratorId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findEnabledCollaboratorForService(
    companyId: string,
    serviceId: string,
    collaboratorId: string,
  ): Promise<EnabledCollaboratorForServiceContext | null> {
    const rows = await db
      .select({
        collaboratorId: CollaboratorTable.id,
        collaboratorName: CollaboratorTable.name,
        commissionPercentage: CollaboratorServiceTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorServiceTable)
      .innerJoin(
        CollaboratorTable,
        and(
          eq(CollaboratorServiceTable.collaboratorId, CollaboratorTable.id),
          eq(CollaboratorServiceTable.companyId, CollaboratorTable.companyId),
        ),
      )
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.serviceId, serviceId),
          eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      collaboratorId: row.collaboratorId,
      collaboratorName: row.collaboratorName,
      commissionPercentage: Number(row.commissionPercentage),
      isActive: row.isActive,
    };
  }

  async listEnabledActiveCollaboratorsForService(
    companyId: string,
    serviceId: string,
  ): Promise<EnabledCollaboratorForServiceContext[]> {
    const rows = await db
      .select({
        collaboratorId: CollaboratorTable.id,
        collaboratorName: CollaboratorTable.name,
        commissionPercentage: CollaboratorServiceTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorServiceTable)
      .innerJoin(
        CollaboratorTable,
        and(
          eq(CollaboratorServiceTable.collaboratorId, CollaboratorTable.id),
          eq(CollaboratorServiceTable.companyId, CollaboratorTable.companyId),
        ),
      )
      .where(
        and(
          eq(CollaboratorServiceTable.companyId, companyId),
          eq(CollaboratorServiceTable.serviceId, serviceId),
          eq(CollaboratorTable.isActive, true),
        ),
      );

    return rows.map((row) => ({
      collaboratorId: row.collaboratorId,
      collaboratorName: row.collaboratorName,
      commissionPercentage: Number(row.commissionPercentage),
      isActive: row.isActive,
    }));
  }

  async findWorkScheduleForDay(
    companyId: string,
    collaboratorId: string,
    dayOfWeek: number,
  ): Promise<DailyWorkScheduleData | null> {
    const rows = await db
      .select({
        dayOfWeek: WorkScheduleTable.dayOfWeek,
        isWorkingDay: WorkScheduleTable.isWorkingDay,
        startTime: WorkScheduleTable.startTime,
        endTime: WorkScheduleTable.endTime,
        breakStart: WorkScheduleTable.breakStart,
        breakEnd: WorkScheduleTable.breakEnd,
      })
      .from(WorkScheduleTable)
      .where(
        and(
          eq(WorkScheduleTable.companyId, companyId),
          eq(WorkScheduleTable.collaboratorId, collaboratorId),
          eq(WorkScheduleTable.dayOfWeek, dayOfWeek),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }
}
