import { z } from "zod";

export const collaboratorIdParamSchema = z.object({
  collaboratorId: z.string().uuid("Invalid collaborator identifier."),
});

export const updateCollaboratorStatusBodySchema = z.object({
  isActive: z.boolean(),
});

const errorResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
} as const;

const collaboratorItemResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
    phone: { type: "string" },
    specialty: { type: "string" },
    commissionPercentage: { type: "number" },
    isActive: { type: "boolean" },
    role: { type: "string", enum: ["COLLABORATOR"] },
  },
  required: [
    "id",
    "name",
    "email",
    "phone",
    "specialty",
    "commissionPercentage",
    "isActive",
    "role",
  ],
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
        maxLength: 15,
      },
      phone: { type: "string", minLength: 10, maxLength: 20 },
      specialty: { type: "string", minLength: 1 },
      commissionPercentage: { type: "number" },
    },
  },
  response: {
    201: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        companyId: { type: "string", format: "uuid" },
        specialty: { type: "string" },
        commissionPercentage: { type: "number" },
        isActive: { type: "boolean" },
      },
      required: ["id", "name", "email", "companyId", "specialty", "commissionPercentage", "isActive"],
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
  summary: "List all collaborators belonging to the authenticated owner's company",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "object",
      properties: {
        collaborators: {
          type: "array",
          items: collaboratorItemResponseSchema,
        },
      },
      required: ["collaborators"],
    },
    401: errorResponseSchema,
    403: errorResponseSchema,
  },
} as const;

export const updateCollaboratorStatusOpenApiSchema = {
  tags: ["Collaborators (Owner)"],
  summary: "Activate or deactivate a collaborator belonging to the authenticated owner's company",
  security: [{ bearerAuth: [] }],
  params: {
    type: "object",
    required: ["collaboratorId"],
    properties: {
      collaboratorId: { type: "string", format: "uuid" },
    },
  },
  body: {
    type: "object",
    required: ["isActive"],
    properties: {
      isActive: { type: "boolean" },
    },
  },
  response: {
    200: collaboratorItemResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
    404: errorResponseSchema,
  },
} as const;
