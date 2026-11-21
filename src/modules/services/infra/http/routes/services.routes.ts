import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeCollaboratorServicesController,
  makePublicCatalogController,
  makeServicesController,
  type ServicesControllersDependencies,
} from "../factories/make-services-controllers.js";

const errorResponseSchema = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
} as const;

export async function servicesRoutes(
  app: FastifyInstance,
  options: ServicesControllersDependencies = {},
): Promise<void> {
  const servicesController = makeServicesController(options);
  const collaboratorServicesController = makeCollaboratorServicesController(options);
  const publicCatalogController = makePublicCatalogController(options);
  const ownerGuard = [authenticate, authorizeRoles("OWNER")];
  const collaboratorGuard = [authenticate, authorizeRoles("COLLABORATOR")];

  app.post(
    "/services",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Services (Owner)"],
        summary: "Create a new service in the company catalog",
        security: [{ bearerAuth: [] }],
      },
    },
    servicesController.create.bind(servicesController),
  );

  app.get(
    "/services",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Services (Owner)"],
        summary: "List all active and inactive services for the authenticated owner's company",
        security: [{ bearerAuth: [] }],
      },
    },
    servicesController.list.bind(servicesController),
  );

  app.patch(
    "/services/:serviceId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Services (Owner)"],
        summary: "Update attributes of an existing company service",
        security: [{ bearerAuth: [] }],
      },
    },
    servicesController.update.bind(servicesController),
  );

  app.patch(
    "/services/:serviceId/status",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Services (Owner)"],
        summary: "Activate or deactivate a company service",
        security: [{ bearerAuth: [] }],
      },
    },
    servicesController.updateStatus.bind(servicesController),
  );

  app.delete(
    "/services/:serviceId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Services (Owner)"],
        summary: "Delete a service if it has no linked appointments",
        security: [{ bearerAuth: [] }],
      },
    },
    servicesController.remove.bind(servicesController),
  );

  app.get(
    "/services/:serviceId/collaborators",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Commissions & Links (Owner)"],
        summary: "List collaborators linked to a company service with their commission percentages",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["serviceId"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["collaborators"],
            properties: {
              collaborators: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "collaboratorId",
                    "name",
                    "specialty",
                    "isActive",
                    "commissionPercentage",
                  ],
                  properties: {
                    collaboratorId: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    specialty: { type: "string" },
                    isActive: { type: "boolean" },
                    commissionPercentage: { type: "number" },
                  },
                },
              },
            },
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    collaboratorServicesController.listByService.bind(collaboratorServicesController),
  );

  app.post(
    "/services/:serviceId/collaborators",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Commissions & Links (Owner)"],
        summary: "Link an active collaborator to a service with their commission percentage",
        security: [{ bearerAuth: [] }],
      },
    },
    collaboratorServicesController.link.bind(collaboratorServicesController),
  );

  app.patch(
    "/services/:serviceId/collaborators/:collaboratorId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Commissions & Links (Owner)"],
        summary: "Update the commission percentage for a collaborator-service link",
        security: [{ bearerAuth: [] }],
      },
    },
    collaboratorServicesController.updateCommission.bind(collaboratorServicesController),
  );

  app.delete(
    "/services/:serviceId/collaborators/:collaboratorId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Commissions & Links (Owner)"],
        summary: "Unlink a collaborator from a service",
        security: [{ bearerAuth: [] }],
      },
    },
    collaboratorServicesController.unlink.bind(collaboratorServicesController),
  );

  app.get(
    "/me/services",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "List only the services and commissions assigned to the authenticated collaborator",
        security: [{ bearerAuth: [] }],
      },
    },
    collaboratorServicesController.listOwnAssignedServices.bind(collaboratorServicesController),
  );

  app.get(
    "/public/companies/:companyId/services",
    {
      schema: {
        tags: ["Public Catalog"],
        summary: "Publicly list company info, active services, and enabled collaborators for a company",
        params: {
          type: "object",
          required: ["companyId"],
          properties: {
            companyId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["company", "services"],
            properties: {
              company: {
                type: "object",
                required: ["id", "companyName", "timezone"],
                properties: {
                  id: { type: "string", format: "uuid" },
                  companyName: { type: "string" },
                  currency: { type: "string", enum: ["BRL", "USD"] },
                  timezone: { type: "string" },
                },
              },
              services: {
                type: "array",
                items: {
                  type: "object",
                  required: [
                    "id",
                    "name",
                    "description",
                    "durationMinutes",
                    "priceInCents",
                    "collaborators",
                  ],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    name: { type: "string" },
                    description: { type: "string", nullable: true },
                    durationMinutes: { type: "integer" },
                    priceInCents: { type: "integer" },
                    collaborators: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "name", "specialty"],
                        properties: {
                          id: { type: "string", format: "uuid" },
                          name: { type: "string" },
                          specialty: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    publicCatalogController.listByCompany.bind(publicCatalogController),
  );
}
