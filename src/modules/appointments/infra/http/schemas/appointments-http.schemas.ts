import { z } from "zod";
import { timezoneSchema } from "../../../../../shared/utils/validation-schemas.js";
import { APPOINTMENT_STATUSES } from "../../../domain/value-objects/appointment-status.vo.js";

const isoDateTimeSchema = z
  .iso
  .datetime({ offset: true, message: "Invalid ISO 8601 date-time string." })
  .transform((value) => new Date(value));

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

export const companyIdParamSchema = z.object({
  companyId: z.string().uuid("Invalid companyId."),
});

export const blockIdParamSchema = z.object({
  blockId: z.string().uuid("Invalid blockId."),
});

export const appointmentIdParamSchema = z.object({
  appointmentId: z.string().uuid("Invalid appointmentId."),
});

export const createOwnerScheduleBlockBodySchema = z.object({
  collaboratorId: z.string().uuid("Invalid collaboratorId.").nullable().optional(),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  reason: z.string().trim().max(500).nullable().optional(),
});

export const createCollaboratorScheduleBlockBodySchema = z.object({
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  reason: z.string().trim().max(500).nullable().optional(),
});

export const listScheduleBlocksQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  collaboratorId: z.string().uuid("Invalid collaboratorId.").optional(),
});

export const listOwnScheduleBlocksQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid("Invalid serviceId."),
  date: localDateSchema,
  collaboratorId: z.string().uuid("Invalid collaboratorId.").optional(),
  timezone: timezoneSchema.optional(),
});

export const ownerAvailabilityQuerySchema = availabilityQuerySchema.omit({ date: true, timezone: true }).extend({
  appointmentId: z.string().uuid().optional(),
});

const clientDataSchema = z.object({
  birthDate: z.iso.date().refine((date) => date <= new Date().toISOString().slice(0, 10)).optional(),
  document: z.string().trim().min(1).max(32).optional(),
  email: z.email().max(254).optional(),
  gender: z.enum(["FEMALE", "MALE", "OTHER"]).optional(),
  source: z.enum(["instagram", "referral", "google", "walk-in"]).optional(),
});

// Payload público nunca aceita endsAt nem status — ambos são derivados/impostos pelo backend.
export const createPublicAppointmentBodySchema = z.object({
  serviceId: z.string().uuid("Invalid serviceId."),
  collaboratorId: z.string().uuid("Invalid collaboratorId."),
  startsAt: isoDateTimeSchema,
  clientName: z.string().trim().min(2, "Client name is too short.").max(120),
  clientPhone: z.string().trim().min(10, "Invalid phone number.").max(30),
  clientData: clientDataSchema.optional(),
});

// Payload interno do OWNER permite escolher initialStatus (PENDING ou CONFIRMED), mas nunca endsAt.
export const createOwnerAppointmentBodySchema = z.object({
  serviceId: z.string().uuid("Invalid serviceId."),
  collaboratorId: z.string().uuid("Invalid collaboratorId."),
  startsAt: isoDateTimeSchema,
  clientName: z.string().trim().min(2, "Client name is too short.").max(120),
  clientPhone: z.string().trim().min(10, "Invalid phone number.").max(30),
  notes: z.string().trim().max(1000).optional(),
  initialStatus: z.enum(["PENDING", "CONFIRMED"]).optional(),
});

export const listAppointmentsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  collaboratorId: z.string().uuid("Invalid collaboratorId.").optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const listOwnAppointmentsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});

export const updateAppointmentStatusBodySchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"]),
  cancellationReason: z.string().trim().max(500).nullable().optional(),
});

export const rescheduleAppointmentBodySchema = z.object({
  startsAt: isoDateTimeSchema,
  collaboratorId: z.string().uuid("Invalid collaboratorId.").optional(),
});

// === OpenAPI / Swagger JSON Schemas ===

export const errorOpenApiSchema = {
  type: "object",
  required: ["message"],
  properties: {
    message: { type: "string" },
  },
} as const;

export const scheduleBlockOpenApiSchema = {
  type: "object",
  required: [
    "id",
    "companyId",
    "collaboratorId",
    "startsAt",
    "endsAt",
    "reason",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    companyId: { type: "string", format: "uuid" },
    collaboratorId: { type: "string", format: "uuid", nullable: true },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    reason: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const createScheduleBlockResponseOpenApiSchema = {
  type: "object",
  required: ["block", "affectedAppointments"],
  properties: {
    block: scheduleBlockOpenApiSchema,
    affectedAppointments: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "collaboratorId",
          "serviceId",
          "clientName",
          "clientPhone",
          "startsAt",
          "endsAt",
          "status",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          collaboratorId: { type: "string", format: "uuid" },
          serviceId: { type: "string", format: "uuid" },
          clientName: { type: "string" },
          clientPhone: { type: "string" },
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["PENDING", "CONFIRMED"] },
        },
      },
    },
  },
} as const;

export const appointmentOpenApiSchema = {
  type: "object",
  required: [
    "id",
    "companyId",
    "collaboratorId",
    "serviceId",
    "clientName",
    "clientPhone",
    "startsAt",
    "endsAt",
    "status",
    "cancellationReason",
    "serviceNameSnapshot",
    "servicePriceInCentsSnapshot",
    "serviceDurationMinutesSnapshot",
    "commissionPercentageSnapshot",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    companyId: { type: "string", format: "uuid" },
    collaboratorId: { type: "string", format: "uuid" },
    serviceId: { type: "string", format: "uuid" },
    clientName: { type: "string" },
    clientPhone: { type: "string" },
    startsAt: { type: "string", format: "date-time" },
    endsAt: { type: "string", format: "date-time" },
    status: {
      type: "string",
      enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"],
    },
    cancellationReason: { type: "string", nullable: true },
    serviceNameSnapshot: { type: "string" },
    servicePriceInCentsSnapshot: { type: "integer" },
    serviceDurationMinutesSnapshot: { type: "integer" },
    commissionPercentageSnapshot: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

export const staffAppointmentOpenApiSchema = {
  ...appointmentOpenApiSchema,
  properties: { ...appointmentOpenApiSchema.properties, notes: { type: "string", nullable: true } },
} as const;

export const availabilityResponseOpenApiSchema = {
  type: "object",
  required: [
    "companyId",
    "serviceId",
    "date",
    "timezone",
    "slotStepMinutes",
    "serviceDurationMinutes",
    "slots",
  ],
  properties: {
    companyId: { type: "string", format: "uuid" },
    serviceId: { type: "string", format: "uuid" },
    date: { type: "string" },
    timezone: { type: "string" },
    slotStepMinutes: { type: "integer" },
    serviceDurationMinutes: { type: "integer" },
    slots: {
      type: "array",
      items: {
        type: "object",
        required: ["startsAt", "endsAt", "collaboratorId", "collaboratorName"],
        properties: {
          startsAt: { type: "string", format: "date-time" },
          endsAt: { type: "string", format: "date-time" },
          collaboratorId: { type: "string", format: "uuid" },
          collaboratorName: { type: "string" },
        },
      },
    },
  },
} as const;
