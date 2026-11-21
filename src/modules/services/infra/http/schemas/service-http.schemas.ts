import { z } from "zod";

export const serviceIdParamSchema = z.object({
  serviceId: z.string().uuid("Invalid service identifier."),
});

export const createServiceBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Service name is required.")
    .max(120, "Service name must be at most 120 characters."),
  description: z
    .string()
    .trim()
    .max(500, "Service description must be at most 500 characters.")
    .nullable()
    .optional(),
  durationMinutes: z
    .number()
    .int("Service duration must be an integer.")
    .positive("Service duration must be greater than zero."),
  priceInCents: z
    .number()
    .int("Service price must be an integer in cents.")
    .min(0, "Service price cannot be negative."),
  imageUrl: z
    .string()
    .trim()
    .max(400_000, "Image URL or data URI too large.")
    .nullable()
    .optional(),
});

export const updateServiceBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Service name cannot be empty.")
      .max(120, "Service name must be at most 120 characters.")
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, "Service description must be at most 500 characters.")
      .nullable()
      .optional(),
    durationMinutes: z
      .number()
      .int("Service duration must be an integer.")
      .positive("Service duration must be greater than zero.")
      .optional(),
    priceInCents: z
      .number()
      .int("Service price must be an integer in cents.")
      .min(0, "Service price cannot be negative.")
      .optional(),
    imageUrl: z
      .string()
      .trim()
      .max(400_000, "Image URL or data URI too large.")
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field must be provided for update.",
  });

export const updateServiceStatusBodySchema = z.object({
  active: z.boolean(),
});

export const serviceCollaboratorParamsSchema = z.object({
  serviceId: z.string().uuid("Invalid service identifier."),
  collaboratorId: z.string().uuid("Invalid collaborator identifier."),
});

const commissionPercentageSchema = z
  .number()
  .min(0, "Commission percentage must be at least 0.")
  .max(100, "Commission percentage cannot exceed 100.");

export const linkCollaboratorServiceBodySchema = z.object({
  collaboratorId: z.string().uuid("Invalid collaborator identifier."),
  commissionPercentage: commissionPercentageSchema,
});

export const updateCommissionBodySchema = z.object({
  commissionPercentage: commissionPercentageSchema,
});

export const publicCompanyIdParamSchema = z.object({
  companyId: z.string().uuid("Invalid company identifier."),
});
