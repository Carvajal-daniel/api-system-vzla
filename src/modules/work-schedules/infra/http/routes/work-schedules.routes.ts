import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import { makeWorkSchedulesController } from "../factories/make-work-schedules-controllers.js";

export async function workSchedulesRoutes(app: FastifyInstance): Promise<void> {
  const workSchedulesController = makeWorkSchedulesController();
  const ownerGuard = [authenticate, authorizeRoles("OWNER")];
  const collaboratorGuard = [authenticate, authorizeRoles("COLLABORATOR")];

  app.put(
    "/collaborators/:collaboratorId/work-schedules",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Work Schedules (Owner)"],
        summary: "Configure one or more weekly work schedule days for a collaborator",
        security: [{ bearerAuth: [] }],
      },
    },
    workSchedulesController.upsert.bind(workSchedulesController),
  );

  app.get(
    "/collaborators/:collaboratorId/work-schedules",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Work Schedules (Owner)"],
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
