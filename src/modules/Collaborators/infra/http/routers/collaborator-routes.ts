import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeRegisterCollaboratorController,
  type RegisterCollaboratorControllerDependencies,
} from "../factories/make-register-collaborator-controller.js";
import { registerCollaboratorOpenApiSchema } from "../schemas/collaborator-http.schemas.js";

export async function CollaboratorRoutes(
  app: FastifyInstance,
  options: RegisterCollaboratorControllerDependencies = {},
): Promise<void> {
  const registerCollaboratorController = makeRegisterCollaboratorController(options);

  app.post(
    "/collaborators",
    {
      preHandler: [authenticate, authorizeRoles("OWNER")],
      schema: registerCollaboratorOpenApiSchema,
    },
    registerCollaboratorController.handle.bind(registerCollaboratorController),
  );
}
