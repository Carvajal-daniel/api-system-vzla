import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeCollaboratorsManagementController,
  makeRegisterCollaboratorController,
  type RegisterCollaboratorControllerDependencies,
} from "../factories/make-register-collaborator-controller.js";
import {
  listCollaboratorsOpenApiSchema,
  registerCollaboratorOpenApiSchema,
  updateCollaboratorStatusOpenApiSchema,
} from "../schemas/collaborator-http.schemas.js";

export async function CollaboratorRoutes(
  app: FastifyInstance,
  options: RegisterCollaboratorControllerDependencies = {},
): Promise<void> {
  const registerCollaboratorController = makeRegisterCollaboratorController(options);
  const managementController = makeCollaboratorsManagementController(options);
  const ownerGuard = [authenticate, authorizeRoles("OWNER")];

  app.post(
    "/collaborators",
    {
      preHandler: ownerGuard,
      schema: registerCollaboratorOpenApiSchema,
    },
    registerCollaboratorController.handle.bind(registerCollaboratorController),
  );

  app.get(
    "/collaborators",
    {
      preHandler: ownerGuard,
      schema: listCollaboratorsOpenApiSchema,
    },
    managementController.list.bind(managementController),
  );

  app.patch(
    "/collaborators/:collaboratorId/status",
    {
      preHandler: ownerGuard,
      schema: updateCollaboratorStatusOpenApiSchema,
    },
    managementController.updateStatus.bind(managementController),
  );
}
