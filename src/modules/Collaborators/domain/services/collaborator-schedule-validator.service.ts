export interface DailyOperatingSchedule {
  dayOfWeek: number;
  isOpen: boolean;
  openTime?: string | null | undefined;
  closeTime?: string | null | undefined;
}

export interface CompanyOperatingContext {
  operatingDays?: string | null | undefined;
  operatingSchedule?: DailyOperatingSchedule[] | null | undefined;
}

export interface CollaboratorDayScheduleInput {
  dayOfWeek: number;
  isWorkingDay: boolean;
  startTime?: string | null | undefined;
  endTime?: string | null | undefined;
  breakStartTime?: string | null | undefined;
  breakEndTime?: string | null | undefined;
}

export class CollaboratorScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollaboratorScheduleValidationError";
  }
}

function toMinutes(time: string): number {
  const parts = time.split(":");
  if (parts.length !== 2) {
    throw new CollaboratorScheduleValidationError(`Formato de hora inválido: "${time}". Use HH:mm.`);
  }
  const hour = Number.parseInt(parts[0]!, 10);
  const min = Number.parseInt(parts[1]!, 10);
  if (Number.isNaN(hour) || Number.isNaN(min) || hour < 0 || hour > 23 || min < 0 || min > 59) {
    throw new CollaboratorScheduleValidationError(`Hora fora dos limites válidos: "${time}".`);
  }
  return hour * 60 + min;
}

export class CollaboratorScheduleValidator {
  static validate(
    schedules: CollaboratorDayScheduleInput[],
    companyContext: CompanyOperatingContext,
  ): CollaboratorDayScheduleInput[] {
    const seenDays = new Set<number>();

    return schedules.map((schedule) => {
      if (schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
        throw new CollaboratorScheduleValidationError(
          `O dia da semana ${schedule.dayOfWeek} é inválido (deve estar entre 0 e 6).`,
        );
      }

      if (seenDays.has(schedule.dayOfWeek)) {
        throw new CollaboratorScheduleValidationError(
          `O dia da semana ${schedule.dayOfWeek} foi informado em duplicidade.`,
        );
      }
      seenDays.add(schedule.dayOfWeek);

      if (!schedule.isWorkingDay) {
        return {
          dayOfWeek: schedule.dayOfWeek,
          isWorkingDay: false,
          startTime: null,
          endTime: null,
          breakStartTime: null,
          breakEndTime: null,
        };
      }

      if (!schedule.startTime || !schedule.endTime) {
        throw new CollaboratorScheduleValidationError(
          `Dia de trabalho ${schedule.dayOfWeek} requer horários de início e término preenchidos.`,
        );
      }

      const startMin = toMinutes(schedule.startTime);
      const endMin = toMinutes(schedule.endTime);

      if (endMin <= startMin) {
        throw new CollaboratorScheduleValidationError(
          `O horário de término (${schedule.endTime}) deve ser maior que o horário de início (${schedule.startTime}).`,
        );
      }

      if (schedule.breakStartTime || schedule.breakEndTime) {
        if (!schedule.breakStartTime || !schedule.breakEndTime) {
          throw new CollaboratorScheduleValidationError(
            `O intervalo de pausa do dia ${schedule.dayOfWeek} deve conter início e término.`,
          );
        }

        const breakStartMin = toMinutes(schedule.breakStartTime);
        const breakEndMin = toMinutes(schedule.breakEndTime);

        if (breakEndMin <= breakStartMin) {
          throw new CollaboratorScheduleValidationError(
            `O término do intervalo (${schedule.breakEndTime}) deve ser posterior ao início (${schedule.breakStartTime}).`,
          );
        }

        if (breakStartMin <= startMin || breakEndMin >= endMin) {
          throw new CollaboratorScheduleValidationError(
            `O intervalo (${schedule.breakStartTime} - ${schedule.breakEndTime}) deve estar estritamente dentro do turno (${schedule.startTime} - ${schedule.endTime}).`,
          );
        }
      }

      if (companyContext.operatingSchedule && Array.isArray(companyContext.operatingSchedule)) {
        const companyDay = companyContext.operatingSchedule.find(
          (d) => d.dayOfWeek === schedule.dayOfWeek,
        );

        if (companyDay && !companyDay.isOpen) {
          throw new CollaboratorScheduleValidationError(
            `A empresa não funciona no dia da semana ${schedule.dayOfWeek}. Não é possível alocar expediente.`,
          );
        }

        if (companyDay && companyDay.openTime && companyDay.closeTime) {
          const compOpenMin = toMinutes(companyDay.openTime);
          const compCloseMin = toMinutes(companyDay.closeTime);

          if (startMin < compOpenMin || endMin > compCloseMin) {
            throw new CollaboratorScheduleValidationError(
              `O horário do colaborador (${schedule.startTime} - ${schedule.endTime}) deve estar contido no horário da empresa (${companyDay.openTime} - ${companyDay.closeTime}).`,
            );
          }
        }
      } else if (companyContext.operatingDays) {
        const allowedDays = companyContext.operatingDays
          .split(",")
          .map((d) => Number.parseInt(d.trim(), 10));

        if (!allowedDays.includes(schedule.dayOfWeek)) {
          throw new CollaboratorScheduleValidationError(
            `A empresa não abre no dia da semana ${schedule.dayOfWeek}.`,
          );
        }
      }

      return {
        dayOfWeek: schedule.dayOfWeek,
        isWorkingDay: true,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        breakStartTime: schedule.breakStartTime ?? null,
        breakEndTime: schedule.breakEndTime ?? null,
      };
    });
  }
}
