import { z } from "zod";
import {
  companyNameSchema,
  emailSchema,
  nameSchema,
  passwordSchema,
  phoneSchema,
  timezoneSchema,
} from "../../../../../shared/utils/validation-schemas.js";

export const registerOwnerBodySchema = z.object({
  companyName: companyNameSchema,
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
  timezone: timezoneSchema.optional(),
});

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

const errorResponseSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
  },
  required: ["message"],
} as const;

const authTokenResponseSchema = {
  type: "object",
  properties: {
    accessToken: { type: "string" },
    tokenType: { type: "string", enum: ["Bearer"] },
    expiresIn: { type: "string" },
    user: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        companyId: { type: "string", format: "uuid" },
        role: { type: "string", enum: ["OWNER", "COLLABORATOR"] },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        companyName: { type: "string" },
      },
      required: ["id", "companyId", "role", "name", "email", "companyName"],
    },
  },
  required: ["accessToken", "tokenType", "expiresIn", "user"],
} as const;

export const registerOwnerOpenApiSchema = {
  tags: ["Authentication"],
  summary: "Register a new company and owner account, returning a JWT access token",
  body: {
    type: "object",
    required: ["companyName", "name", "phone", "email", "password"],
    properties: {
      companyName: { type: "string", minLength: 3, maxLength: 100 },
      name: { type: "string", minLength: 2, maxLength: 80 },
      phone: { type: "string", minLength: 10, maxLength: 20 },
      email: { type: "string" },
      password: {
        type: "string",
        minLength: 6,
        maxLength: 15,
        description: "6 to 15 characters including at least one special character",
      },
      timezone: {
        type: "string",
        maxLength: 64,
        description: "Valid IANA timezone (e.g. America/Sao_Paulo, America/Caracas)",
      },
    },
  },
  response: {
    201: authTokenResponseSchema,
    400: errorResponseSchema,
    409: errorResponseSchema,
  },
} as const;

export const loginOpenApiSchema = {
  tags: ["Authentication"],
  summary: "Authenticate an active owner or collaborator and issue a JWT access token",
  body: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email: { type: "string" },
      password: { type: "string", minLength: 1 },
    },
  },
  response: {
    200: authTokenResponseSchema,
    400: errorResponseSchema,
    401: errorResponseSchema,
    403: errorResponseSchema,
  },
} as const;

export const getMeOpenApiSchema = {
  tags: ["Authentication"],
  summary: "Return the authenticated owner or collaborator profile and company info",
  security: [{ bearerAuth: [] }],
  response: {
    200: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["OWNER", "COLLABORATOR"] },
        id: { type: "string", format: "uuid" },
        companyId: { type: "string", format: "uuid" },
        name: { type: "string" },
        email: { type: "string", format: "email" },
        phone: { type: "string" },
        specialty: { type: "string" },
        commissionPercentage: { type: "number" },
        isActive: { type: "boolean" },
        company: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            companyName: { type: "string" },
            isActive: { type: "boolean" },
          },
          required: ["id", "companyName", "isActive"],
        },
      },
      required: ["role", "id", "companyId", "name", "email", "phone", "isActive", "company"],
    },
    401: errorResponseSchema,
  },
} as const;
