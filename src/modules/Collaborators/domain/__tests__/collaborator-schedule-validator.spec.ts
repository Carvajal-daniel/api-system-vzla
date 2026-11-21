import { describe, expect, it } from "vitest";
import {
  CollaboratorScheduleValidationError,
  CollaboratorScheduleValidator,
} from "../services/collaborator-schedule-validator.service.js";

describe("CollaboratorScheduleValidator", () => {
  const companyContext = {
    operatingSchedule: [
      { dayOfWeek: 1, isOpen: true, openTime: "08:00", closeTime: "19:00" },
      { dayOfWeek: 2, isOpen: true, openTime: "08:00", closeTime: "19:00" },
      { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
    ],
  };

  it("permite jornadas válidas alinhadas ao horário da empresa", () => {
    const valid = CollaboratorScheduleValidator.validate(
      [
        {
          dayOfWeek: 1,
          isWorkingDay: true,
          startTime: "09:00",
          endTime: "18:00",
          breakStartTime: "12:00",
          breakEndTime: "13:00",
        },
        {
          dayOfWeek: 2,
          isWorkingDay: false,
        },
      ],
      companyContext,
    );

    expect(valid).toHaveLength(2);
    expect(valid[0]?.isWorkingDay).toBe(true);
    expect(valid[0]?.startTime).toBe("09:00");
    expect(valid[1]?.isWorkingDay).toBe(false);
    expect(valid[1]?.startTime).toBeNull();
  });

  it("rejeita dia de trabalho quando a empresa estiver fechada", () => {
    expect(() =>
      CollaboratorScheduleValidator.validate(
        [
          {
            dayOfWeek: 0,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "17:00",
          },
        ],
        companyContext,
      ),
    ).toThrow(CollaboratorScheduleValidationError);
  });

  it("rejeita horários que excedam os limites da empresa", () => {
    expect(() =>
      CollaboratorScheduleValidator.validate(
        [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "07:30", // Antes das 08:00
            endTime: "18:00",
          },
        ],
        companyContext,
      ),
    ).toThrow(CollaboratorScheduleValidationError);
  });

  it("rejeita intervalo de almoço fora do turno", () => {
    expect(() =>
      CollaboratorScheduleValidator.validate(
        [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "17:00",
            breakStartTime: "17:30", // Depois das 17:00
            breakEndTime: "18:00",
          },
        ],
        companyContext,
      ),
    ).toThrow(CollaboratorScheduleValidationError);
  });
});
