import { randomUUID } from "node:crypto";
import {
  InvalidDayOfWeekError,
  InvalidWorkScheduleBreakError,
  InvalidWorkScheduleTimeError,
} from "../errors/work-schedule-errors.js";
import { TimeOfDay } from "../value-objects/time-of-day.vo.js";

export interface WorkScheduleProps {
  id: string;
  companyId: string;
  collaboratorId: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkScheduleProps {
  id?: string | undefined;
  companyId: string;
  collaboratorId: string;
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  breakStart?: string | null | undefined;
  breakEnd?: string | null | undefined;
}

export class WorkScheduleEntity {
  private constructor(private readonly props: WorkScheduleProps) {}

  static create(input: CreateWorkScheduleProps): WorkScheduleEntity {
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      throw new InvalidDayOfWeekError();
    }

    const now = new Date();

    if (!input.isWorkingDay) {
      return new WorkScheduleEntity({
        id: input.id ?? randomUUID(),
        companyId: input.companyId,
        collaboratorId: input.collaboratorId,
        dayOfWeek: input.dayOfWeek,
        isWorkingDay: false,
        startTime: null,
        endTime: null,
        breakStart: null,
        breakEnd: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!input.startTime || !input.endTime) {
      throw new InvalidWorkScheduleTimeError();
    }

    const start = TimeOfDay.create(input.startTime);
    const end = TimeOfDay.create(input.endTime);

    if (end.toMinutes() <= start.toMinutes()) {
      throw new InvalidWorkScheduleTimeError();
    }

    const hasBreakStart = input.breakStart !== undefined && input.breakStart !== null;
    const hasBreakEnd = input.breakEnd !== undefined && input.breakEnd !== null;

    if (hasBreakStart !== hasBreakEnd) {
      throw new InvalidWorkScheduleBreakError();
    }

    let breakStartValue: string | null = null;
    let breakEndValue: string | null = null;

    if (hasBreakStart && hasBreakEnd && input.breakStart && input.breakEnd) {
      const breakStart = TimeOfDay.create(input.breakStart);
      const breakEnd = TimeOfDay.create(input.breakEnd);

      if (
        breakStart.toMinutes() <= start.toMinutes() ||
        breakEnd.toMinutes() <= breakStart.toMinutes() ||
        breakEnd.toMinutes() >= end.toMinutes()
      ) {
        throw new InvalidWorkScheduleBreakError();
      }

      breakStartValue = breakStart.value;
      breakEndValue = breakEnd.value;
    }

    return new WorkScheduleEntity({
      id: input.id ?? randomUUID(),
      companyId: input.companyId,
      collaboratorId: input.collaboratorId,
      dayOfWeek: input.dayOfWeek,
      isWorkingDay: true,
      startTime: start.value,
      endTime: end.value,
      breakStart: breakStartValue,
      breakEnd: breakEndValue,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: WorkScheduleProps): WorkScheduleEntity {
    return new WorkScheduleEntity({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get collaboratorId(): string {
    return this.props.collaboratorId;
  }

  get dayOfWeek(): number {
    return this.props.dayOfWeek;
  }

  get isWorkingDay(): boolean {
    return this.props.isWorkingDay;
  }

  get startTime(): string | null {
    return this.props.startTime;
  }

  get endTime(): string | null {
    return this.props.endTime;
  }

  get breakStart(): string | null {
    return this.props.breakStart;
  }

  get breakEnd(): string | null {
    return this.props.breakEnd;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
