import type { WorkScheduleEntity } from "../../domain/entities/work-schedule.entity.js";

export interface WorkScheduleOutputDTO {
  id: string;
  companyId: string;
  collaboratorId: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
}

export interface WorkScheduleDayInputDTO {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  breakStart?: string | null | undefined;
  breakEnd?: string | null | undefined;
}

export interface UpsertCollaboratorWorkSchedulesInputDTO {
  collaboratorId: string;
  schedules: WorkScheduleDayInputDTO[];
}

export function toWorkScheduleOutputDTO(schedule: WorkScheduleEntity): WorkScheduleOutputDTO {
  return {
    id: schedule.id,
    companyId: schedule.companyId,
    collaboratorId: schedule.collaboratorId,
    dayOfWeek: schedule.dayOfWeek,
    isWorkingDay: schedule.isWorkingDay,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    breakStart: schedule.breakStart,
    breakEnd: schedule.breakEnd,
  };
}
