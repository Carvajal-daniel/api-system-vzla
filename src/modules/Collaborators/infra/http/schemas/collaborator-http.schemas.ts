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
