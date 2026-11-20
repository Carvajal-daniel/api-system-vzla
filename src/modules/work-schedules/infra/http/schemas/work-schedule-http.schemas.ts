import { z } from "zod";

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time must be in valid 24-hour HH:MM format.");

export const collaboratorIdParamSchema = z.object({
  collaboratorId: z.string().uuid("Invalid collaborator identifier."),
});

export const workScheduleDayInputSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isWorkingDay: z.boolean(),
  startTime: timeOfDaySchema.nullable().optional(),
  endTime: timeOfDaySchema.nullable().optional(),
  breakStart: timeOfDaySchema.nullable().optional(),
  breakEnd: timeOfDaySchema.nullable().optional(),
});

export const upsertWorkSchedulesBodySchema = z.object({
  schedules: z
    .array(workScheduleDayInputSchema)
    .min(1, "At least one schedule entry is required.")
    .max(7, "At most 7 schedule entries are allowed."),
});
