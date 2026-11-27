import { z } from "zod";
import { WAITLIST_SHIFTS } from "../../../../operations/infra/database/schema/operations-schema.js";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const documentRegex = /^\d{11}$|^\d{14}$/;

// === Zod Validation Schemas ===

export const slugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2, "Slug inválido.")
    .max(120, "Slug inválido.")
    .transform((v) => v.toLowerCase()),
});

export const paymentStatusParamsSchema = slugParamSchema.extend({
  paymentId: z.uuid("paymentId inválido."),
});

export const publicAvailabilityQuerySchema = z.object({
  serviceId: z.uuid("serviceId inválido."),
  date: z.string().regex(isoDateRegex, "date deve estar no formato YYYY-MM-DD."),
  collaboratorId: z.uuid("collaboratorId inválido.").optional(),
});

export const publicIdentifyBodySchema = z.object({
  phone: z.string().trim().min(10, "Telefone inválido.").max(30, "Telefone inválido."),
  name: z.string().trim().min(2).max(120).optional(),
});

export const publicCreateAppointmentBodySchema = z.object({
  serviceId: z.uuid("serviceId inválido."),
  collaboratorId: z.uuid("collaboratorId inválido."),
  startsAt: z.coerce.date(),
  clientName: z.string().trim().min(2, "Informe seu nome completo.").max(120),
  clientPhone: z.string().trim().min(10, "Telefone inválido.").max(30),
  clientData: z.record(z.string().max(60), z.string().trim().max(500)).optional(),
  document: z.string().trim().regex(documentRegex, "CPF/CNPJ deve conter 11 ou 14 dígitos.").optional(),
});

export const publicClubSubscribeBodySchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome completo.").max(120),
  customerPhone: z.string().trim().min(10, "Telefone inválido.").max(30),
  planId: z.uuid("planId inválido."),
  document: z.string().trim().regex(documentRegex, "CPF/CNPJ deve conter 11 ou 14 dígitos.").optional(),
});

export const publicWaitlistBodySchema = z.object({
  customerName: z.string().trim().min(2, "Informe seu nome completo.").max(120),
  customerPhone: z.string().trim().min(10, "Telefone inválido.").max(30),
  desiredDate: z.string().regex(isoDateRegex, "desiredDate deve estar no formato YYYY-MM-DD."),
  collaboratorId: z.uuid("collaboratorId inválido.").nullable().optional(),
  preferredShift: z.enum(WAITLIST_SHIFTS).default("ANY"),
});

// === OpenAPI / Swagger Schemas ===

export const publicErrorOpenApiSchema = {
  type: "object",
  required: ["message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
  },
} as const;

export const publicPaymentChargeOpenApiSchema = {
  type: "object",
  nullable: true,
  required: [
    "paymentId",
    "amountCents",
    "status",
    "qrCodeBase64",
    "copyPaste",
    "checkoutUrl",
    "expiresAt",
  ],
  properties: {
    paymentId: { type: "string", format: "uuid", nullable: true },
    amountCents: { type: "integer" },
    status: { type: "string", enum: ["PENDING", "CONFIRMED", "EXPIRED", "CANCELED"] },
    qrCodeBase64: { type: "string", nullable: true },
    copyPaste: { type: "string", nullable: true },
    checkoutUrl: { type: "string", nullable: true },
    expiresAt: { type: "string", format: "date-time", nullable: true },
  },
} as const;

export const publicStorefrontResponseOpenApiSchema = {
  type: "object",
  required: ["company", "depositPolicy", "services", "clubPlans"],
  properties: {
    company: {
      type: "object",
      required: ["id", "companyName", "slug", "phone", "whatsapp", "timezone", "currency"],
      properties: {
        id: { type: "string", format: "uuid" },
        companyName: { type: "string" },
        slug: { type: "string" },
        phone: { type: "string" },
        whatsapp: { type: "string" },
        timezone: { type: "string" },
        currency: { type: "string" },
        avatarUrl: { type: "string", nullable: true },
        description: { type: "string", nullable: true },
        address: { type: "object", nullable: true, additionalProperties: true },
        appearance: {
          type: "object",
          nullable: true,
          properties: {
            mode: { type: "string", enum: ["light", "dark"] },
            locale: { type: "string", enum: ["pt-BR", "es"] },
            palette: { type: "string" },
          },
        },
        operatingDays: { type: "string", nullable: true },
        operatingSchedule: { nullable: true },
      },
    },
    depositPolicy: {
      type: "object",
      required: [
        "enabled",
        "depositPercentage",
        "autoRefundHours",
        "noShowPolicy",
        "hasActivePaymentProvider",
      ],
      properties: {
        enabled: { type: "boolean" },
        depositPercentage: { type: "integer" },
        autoRefundHours: { type: "integer" },
        noShowPolicy: { type: "string" },
        hasActivePaymentProvider: { type: "boolean" },
      },
    },
    services: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "durationMinutes", "priceInCents", "collaborators"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          durationMinutes: { type: "integer" },
          priceInCents: { type: "integer" },
          imageUrl: { type: "string", nullable: true },
          collaborators: {
            type: "array",
            items: {
              type: "object",
              required: ["id", "name"],
              properties: {
                id: { type: "string", format: "uuid" },
                name: { type: "string" },
                specialty: { type: "string", nullable: true },
                avatarUrl: { type: "string", nullable: true },
              },
            },
          },
        },
      },
    },
    clubPlans: {
      type: "array",
      items: {
        type: "object",
        required: [
          "id",
          "name",
          "priceCents",
          "billingCycle",
          "includedServiceIds",
          "gracePeriodDays",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string", nullable: true },
          priceCents: { type: "integer" },
          billingCycle: { type: "string", enum: ["MONTHLY"] },
          includedServiceIds: { type: "array", items: { type: "string", format: "uuid" } },
          maxMonthlyUses: { type: "integer", nullable: true },
          allowedDaysOfWeek: {
            type: "array",
            nullable: true,
            items: { type: "integer" },
          },
          gracePeriodDays: { type: "integer" },
        },
      },
    },
  },
} as const;

export const publicIdentifyResponseOpenApiSchema = {
  type: "object",
  required: ["recognized", "customerName", "isSubscriber", "subscription"],
  properties: {
    recognized: { type: "boolean" },
    customerName: { type: "string", nullable: true },
    isSubscriber: { type: "boolean" },
    subscription: {
      type: "object",
      nullable: true,
      required: [
        "planId",
        "planName",
        "status",
        "includedServiceIds",
        "allowedDaysOfWeek",
        "maxMonthlyUses",
        "remainingUses",
        "exemptsServicePrice",
        "exemptsDeposit",
      ],
      properties: {
        planId: { type: "string", format: "uuid" },
        planName: { type: "string" },
        status: { type: "string", enum: ["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] },
        includedServiceIds: { type: "array", items: { type: "string", format: "uuid" } },
        allowedDaysOfWeek: {
          type: "array",
          nullable: true,
          items: { type: "integer" },
        },
        maxMonthlyUses: { type: "integer", nullable: true },
        remainingUses: { type: "integer", nullable: true },
        exemptsServicePrice: { type: "boolean" },
        exemptsDeposit: { type: "boolean" },
      },
    },
  },
} as const;

export const publicAppointmentResponseOpenApiSchema = {
  type: "object",
  required: [
    "appointment",
    "cancellationToken",
    "coveredByClub",
    "requiresDeposit",
    "payment",
  ],
  properties: {
    appointment: {
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
        "usesClubBenefit",
        "serviceNameSnapshot",
        "servicePriceInCentsSnapshot",
        "serviceDurationMinutesSnapshot",
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
        status: { type: "string", enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"] },
        usesClubBenefit: { type: "boolean" },
        serviceNameSnapshot: { type: "string" },
        servicePriceInCentsSnapshot: { type: "integer" },
        serviceDurationMinutesSnapshot: { type: "integer" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    cancellationToken: { type: "string" },
    coveredByClub: { type: "boolean" },
    requiresDeposit: { type: "boolean" },
    payment: publicPaymentChargeOpenApiSchema,
  },
} as const;

export const publicClubSubscribeResponseOpenApiSchema = {
  type: "object",
  required: ["subscriptionId", "planId", "status", "payment"],
  properties: {
    subscriptionId: { type: "string", format: "uuid" },
    planId: { type: "string", format: "uuid" },
    status: { type: "string" },
    payment: {
      ...publicPaymentChargeOpenApiSchema,
      nullable: false,
    },
  },
} as const;

export const publicWaitlistResponseOpenApiSchema = {
  type: "object",
  required: [
    "id",
    "desiredDate",
    "preferredShift",
    "collaboratorId",
    "collaboratorName",
    "status",
    "createdAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    desiredDate: { type: "string" },
    preferredShift: { type: "string", enum: [...WAITLIST_SHIFTS] },
    collaboratorId: { type: "string", format: "uuid", nullable: true },
    collaboratorName: { type: "string", nullable: true },
    status: { type: "string", enum: ["WAITING", "NOTIFIED", "CONVERTED", "EXPIRED"] },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

export const publicPaymentStatusResponseOpenApiSchema = {
  type: "object",
  required: ["paymentId", "status", "expiresAt", "paidAt"],
  properties: {
    paymentId: { type: "string", format: "uuid" },
    status: { type: "string", enum: ["PENDING", "CONFIRMED", "EXPIRED", "CANCELED"] },
    expiresAt: { type: "string", format: "date-time", nullable: true },
    paidAt: { type: "string", format: "date-time", nullable: true },
  },
} as const;
