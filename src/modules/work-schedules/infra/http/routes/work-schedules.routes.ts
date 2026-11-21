import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import { makeWorkSchedulesController } from "../factories/make-work-schedules-controllers.js";

export async function workSchedulesRoutes(app: FastifyInstance): Promise<void> {
  const workSchedulesController = makeWorkSchedulesController();
  const ownerOrCollaboratorGuard = [
    authenticate,
    authorizeRoles("OWNER", "COLLABORATOR"),
  ];
  const collaboratorGuard = [authenticate, authorizeRoles("COLLABORATOR")];

  app.put(
    "/collaborators/:collaboratorId/work-schedules",
    {
      preHandler: ownerOrCollaboratorGuard,
      schema: {
        tags: ["Work Schedules (Owner & Collaborator)"],
        summary: "Configure one or more weekly work schedule days for a collaborator",
        security: [{ bearerAuth: [] }],
      },
    },
    workSchedulesController.upsert.bind(workSchedulesController),
  );

  app.get(
    "/collaborators/:collaboratorId/work-schedules",
    {
      preHandler: ownerOrCollaboratorGuard,
      schema: {
        tags: ["Work Schedules (Owner & Collaborator)"],
        summary: "List configured weekly work schedules for a collaborator",
        security: [{ bearerAuth: [] }],
      },
    },
    workSchedulesController.listByCollaborator.bind(workSchedulesController),
  );

  app.get(
    "/me/work-schedules",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "List own weekly work schedules for the authenticated collaborator",
        security: [{ bearerAuth: [] }],
      },
    },
    workSchedulesController.listOwn.bind(workSchedulesController),
  );
}
