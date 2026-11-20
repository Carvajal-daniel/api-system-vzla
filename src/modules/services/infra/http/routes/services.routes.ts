import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeCollaboratorServicesController,
  makePublicCatalogController,
  makeServicesController,
} from "../factories/make-services-controllers.js";

export async function servicesRoutes(app: FastifyInstance): Promise<void> {
  const servicesController = makeServicesController();
  const collaboratorServicesController = makeCollaboratorServicesController();
  const publicCatalogController = makePublicCatalogController();
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
        summary: "Publicly list active services and enabled collaborators for a company",
      },
    },
    publicCatalogController.listByCompany.bind(publicCatalogController),
  );
}
