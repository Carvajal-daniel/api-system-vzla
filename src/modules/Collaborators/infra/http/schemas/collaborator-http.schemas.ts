import { z } from "zod";

export const collaboratorIdParamSchema = z.object({
  collaboratorId: z.string().uuid("Identificador do colaborador inválido."),
});

export const listCollaboratorsQuerySchema = z.object({
  serviceId: z.string().uuid().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  includeMetrics: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => val !== "false"),
});

export const createCollaboratorBodySchema = z.object({
  name: z.string().trim().min(2, "Nome deve ter ao menos 2 caracteres.").max(80),
  email: z.string().trim().email("E-mail inválido."),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres.").max(30),
  phone: z.string().trim().min(8, "Telefone inválido.").max(25),
  whatsapp: z.string().trim().max(25).optional().nullable(),
  specialty: z.string().trim().min(1, "Especialidade é obrigatória.").max(120),
  bio: z.string().trim().max(1000).optional().nullable(),
  commissionPercentage: z.number().min(0).max(100).optional(),
  defaultCommissionRate: z.number().min(0).max(100).optional(),
  monthlyRevenueGoal: z.number().int().min(0).optional().nullable(),
  avatarUrl: z.string().trim().optional().nullable(),
  hiredAt: z.string().optional(),
});

export const updateCollaboratorBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    phone: z.string().trim().min(8).max(25).optional(),
    whatsapp: z.string().trim().max(25).optional().nullable(),
    specialty: z.string().trim().min(1).max(120).optional(),
    bio: z.string().trim().max(1000).optional().nullable(),
    commissionPercentage: z.number().min(0).max(100).optional(),
    defaultCommissionRate: z.number().min(0).max(100).optional(),
    monthlyRevenueGoal: z.number().int().min(0).optional().nullable(),
    avatarUrl: z.string().trim().optional().nullable(),
    hiredAt: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Ao menos um campo deve ser fornecido para atualização.",
  });

export const updateCollaboratorStatusBodySchema = z.object({
  isActive: z.boolean(),
});

export const syncCollaboratorServicesBodySchema = z.object({
  services: z.array(
    z.object({
      serviceId: z.string().uuid("ID de serviço inválido."),
      customCommissionRate: z.number().min(0).max(100).optional().nullable(),
    }),
  ),
});

export const syncCollaboratorScheduleBodySchema = z.object({
  schedules: z.array(
    z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      isWorkingDay: z.boolean(),
      startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm").optional().nullable(),
      endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm").optional().nullable(),
      breakStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm").optional().nullable(),
      breakEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Formato HH:mm").optional().nullable(),
    }),
  ),
});

export const updateCollaboratorCredentialsBodySchema = z
  .object({
    email: z.string().trim().email("E-mail inválido.").optional(),
    password: z.string().min(6, "Senha deve ter no mínimo 6 caracteres.").max(30).optional(),
  })
  .refine((data) => data.email !== undefined || data.password !== undefined, {
    message: "Informe ao menos um e-mail ou uma nova senha.",
  });

export const deactivateCollaboratorBodySchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
  queueAiReschedule: z.boolean().default(true),
});

export const closeMonthAwardBodySchema = z.object({
  referenceMonth: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês de referência inválido. Use o formato YYYY-MM (ex.: 2026-11)."),
});

const errorResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
} as const;

export const registerCollaboratorOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "Register a new collaborator for the authenticated owner's company",
  security: [{ bearerAuth: [] }],
  body: {
    type: "object",
    required: ["name", "email", "password", "phone", "specialty", "commissionPercentage"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 80 },
      email: { type: "string" },
      password: {
        type: "string",
        minLength: 6,
        maxLength: 30,
      },
      phone: { type: "string", minLength: 8, maxLength: 25 },
      specialty: { type: "string", minLength: 1 },
      commissionPercentage: { type: "number" },
      whatsapp: { type: "string", nullable: true },
      bio: { type: "string", nullable: true },
      defaultCommissionRate: { type: "number" },
      monthlyRevenueGoal: { type: "number", nullable: true },
      avatarUrl: { type: "string", nullable: true },
      hiredAt: { type: "string" },
    },
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        phone: { type: "string" },
        whatsapp: { type: "string", nullable: true },
        companyId: { type: "string", format: "uuid" },
        specialty: { type: "string" },
        bio: { type: "string", nullable: true },
        defaultCommissionRate: { type: "number" },
        commissionPercentage: { type: "number" },
        status: { type: "string" },
        isActive: { type: "boolean" },
        avatarUrl: { type: "string", nullable: true },
        hiredAt: { type: "string" },
      },
      required: ["id", "name", "email", "companyId", "specialty", "isActive"],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema,
  },
} as const;

export const listCollaboratorsOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "List all collaborators with monthly metrics and team KPIs",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "object",
      additionalProperties: true,
      properties: {
        teamKpis: {
          type: "object",
          additionalProperties: true,
          properties: {
            totalCollaborators: { type: "number" },
            activeCollaborators: { type: "number" },
            totalCompletedAppointmentsMonth: { type: "number" },
            totalRevenueMonthInCents: { type: "number" },
            averageTeamRating: { type: "number" },
          },
        },
        collaborators: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string", format: "uuid" },
              companyId: { type: "string", format: "uuid" },
              name: { type: "string" },
              email: { type: "string" },
              phone: { type: "string" },
              whatsapp: { type: "string", nullable: true },
              bio: { type: "string", nullable: true },
              specialty: { type: "string" },
              role: { type: "string" },
              commissionPercentage: { type: "number" },
              defaultCommissionRate: { type: "number" },
              monthlyRevenueGoal: { type: "number", nullable: true },
              status: { type: "string" },
              isActive: { type: "boolean" },
              avatarUrl: { type: "string", nullable: true },
              hiredAt: { type: "string" },
              completedAppointmentsMonth: { type: "number" },
              servicesRevenueMonthInCents: { type: "number" },
              productsSalesMonthInCents: { type: "number" },
              productsSoldCountMonth: { type: "number" },
              revenueMonthInCents: { type: "number" },
              commissionMonthInCents: { type: "number" },
              averageRating: { type: "number" },
              totalReviews: { type: "number" },
              rankingPosition: { type: "number" },
              rankingScore: { type: "number" },
              rankingPillars: { type: "object", additionalProperties: true },
              awardsCount: { type: "number" },
            },
          },
        },
      },
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
  },
} as const;

export const collaboratorProfileOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "Get complete dossier for Bento Grid profile view",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "object",
      additionalProperties: true,
      properties: {
        collaborator: { type: "object", additionalProperties: true },
        tenureFormatted: { type: "string" },
        tenureMonths: { type: "number" },
        ranking: { type: "object", additionalProperties: true },
        stats: { type: "object", additionalProperties: true },
        awards: { type: "array", items: { type: "object", additionalProperties: true } },
        recentReviews: { type: "array", items: { type: "object", additionalProperties: true } },
        services: { type: "array", items: { type: "object", additionalProperties: true } },
        schedules: { type: "array", items: { type: "object", additionalProperties: true } },
      },
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
} as const;

export const updateCollaboratorStatusOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "Update collaborator active status",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        isActive: { type: "boolean" },
        status: { type: "string" },
      },
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
} as const;

export const closeMonthAwardOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "Close a reference month and award the #1 ranked collaborator as Employee of the Month",
  security: [{ bearerAuth: [] }],
  body: {
    type: "object",
    required: ["referenceMonth"],
    properties: {
      referenceMonth: {
        type: "string",
        pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
        description: "Reference month in YYYY-MM format (e.g. 2026-11)",
      },
    },
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        companyId: { type: "string", format: "uuid" },
        collaboratorId: { type: "string", format: "uuid" },
        collaboratorName: { type: "string" },
        title: { type: "string" },
        referenceMonth: { type: "string" },
        score: { type: "number" },
        createdAt: { type: "string" },
      },
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    409: errorResponseSchema,
  },
} as const;
