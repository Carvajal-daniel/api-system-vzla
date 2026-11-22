import type { DailyWorkScheduleData } from "../services/availability-calculator.js";

export interface CompanyOperatingDaySchedule {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
}

export interface ActiveCompanyContext {
  id: string;
  companyName: string;
  timezone: string;
  isActive: boolean;
  operatingDays?: string | null | undefined;
  agendaInterval?: number;
  bookingInterval?: number;
  leadTime?: number;
  clientFields?: Record<string, "required" | "optional" | "hidden">;
  operatingSchedule?: CompanyOperatingDaySchedule[] | null | undefined;
}

export interface ActiveServiceContext {
  id: string;
  companyId: string;
  name: string;
  durationMinutes: number;
  priceInCents: number;
  active: boolean;
}

export interface EnabledCollaboratorForServiceContext {
  collaboratorId: string;
  collaboratorName: string;
  commissionPercentage: number;
  isActive: boolean;
}

export interface SchedulingContextLookupRepository {
  findCompanyById(companyId: string): Promise<ActiveCompanyContext | null>;

  findServiceById(
    companyId: string,
    serviceId: string,
  ): Promise<ActiveServiceContext | null>;

  findCollaboratorInCompany(
    companyId: string,
    collaboratorId: string,
  ): Promise<{ id: string; name: string; isActive: boolean } | null>;

  findEnabledCollaboratorForService(
    companyId: string,
    serviceId: string,
    collaboratorId: string,
  ): Promise<EnabledCollaboratorForServiceContext | null>;

  listEnabledActiveCollaboratorsForService(
    companyId: string,
    serviceId: string,
  ): Promise<EnabledCollaboratorForServiceContext[]>;

  findWorkScheduleForDay(
    companyId: string,
    collaboratorId: string,
    dayOfWeek: number,
  ): Promise<DailyWorkScheduleData | null>;
}
