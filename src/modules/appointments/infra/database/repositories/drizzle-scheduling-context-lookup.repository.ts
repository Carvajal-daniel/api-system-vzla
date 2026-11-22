import { and, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanySettingsTable, selectedClientFields } from "../../../../Company/infra/database/schema/company-settings-schema.js";
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
        operatingDays: CompanyTable.operatingDays,
        operatingSchedule: CompanyTable.operatingSchedule,
        preferences: CompanySettingsTable.preferences,
      })
      .from(CompanyTable)
      .leftJoin(CompanySettingsTable, eq(CompanySettingsTable.companyId, CompanyTable.id))
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      agendaInterval: row.preferences?.agendaInterval ?? 30,
      bookingInterval: row.preferences?.bookingInterval ?? 0,
      leadTime: row.preferences?.leadTime ?? 0,
      clientFields: Object.fromEntries(selectedClientFields(row.preferences).map(({ id, mode }) => [id, mode])),
      companyName: row.companyName,
      timezone: row.timezone,
      isActive: row.isActive,
      operatingDays: row.operatingDays,
      operatingSchedule: (row.operatingSchedule as ActiveCompanyContext["operatingSchedule"]) ?? null,
    };
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
    if (row) {
      return {
        collaboratorId: row.collaboratorId,
        collaboratorName: row.collaboratorName,
        commissionPercentage: Number(row.commissionPercentage),
        isActive: row.isActive,
      };
    }

    // Fallback: se o colaborador pertencer à empresa e estiver ativo, permite o agendamento usando sua comissão padrão
    const directRows = await db
      .select({
        collaboratorId: CollaboratorTable.id,
        collaboratorName: CollaboratorTable.name,
        commissionPercentage: CollaboratorTable.commissionPercentage,
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

    const direct = directRows[0];
    if (!direct) return null;

    return {
      collaboratorId: direct.collaboratorId,
      collaboratorName: direct.collaboratorName,
      commissionPercentage: Number(direct.commissionPercentage),
      isActive: direct.isActive,
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

    if (rows.length > 0) {
      return rows.map((row) => ({
        collaboratorId: row.collaboratorId,
        collaboratorName: row.collaboratorName,
        commissionPercentage: Number(row.commissionPercentage),
        isActive: row.isActive,
      }));
    }

    // Fallback inteligente: se a empresa não configurou tabela de comissões exclusivas para o serviço,
    // todos os colaboradores ativos da empresa ficam elegíveis para atendimento com sua comissão padrão.
    const allActive = await db
      .select({
        collaboratorId: CollaboratorTable.id,
        collaboratorName: CollaboratorTable.name,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.companyId, companyId),
          eq(CollaboratorTable.isActive, true),
        ),
      );

    return allActive.map((c) => ({
      collaboratorId: c.collaboratorId,
      collaboratorName: c.collaboratorName,
      commissionPercentage: Number(c.commissionPercentage),
      isActive: c.isActive,
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
