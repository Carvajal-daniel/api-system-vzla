import type { FastifyInstance } from "fastify";
import {
  authenticate,
  authorizeRoles,
} from "../../../../../shared/http/auth/authenticate.js";
import {
  type AppointmentsDependencies,
  makeAppointmentsControllers,
} from "../factories/make-appointments-controllers.js";
import {
  appointmentOpenApiSchema,
  availabilityResponseOpenApiSchema,
  createScheduleBlockResponseOpenApiSchema,
  errorOpenApiSchema,
  scheduleBlockOpenApiSchema,
} from "../schemas/appointments-http.schemas.js";

export async function appointmentsRoutes(
  app: FastifyInstance,
  deps: AppointmentsDependencies = {},
): Promise<void> {
  const { scheduleBlocksController, appointmentsController } =
    makeAppointmentsControllers(deps);

  const ownerGuard = [authenticate, authorizeRoles("OWNER")];
  const collaboratorGuard = [authenticate, authorizeRoles("COLLABORATOR")];
  const staffGuard = [authenticate, authorizeRoles("OWNER", "COLLABORATOR")];

  // === Schedule Blocks (Owner) ===
  app.post(
    "/schedule-blocks",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Schedule Blocks (Owner)"],
        summary: "Create a collaborator or company-wide schedule block",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["startsAt", "endsAt"],
          properties: {
            collaboratorId: { type: "string", format: "uuid", nullable: true },
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
            reason: { type: "string", maxLength: 500, nullable: true },
          },
        },
        response: {
          201: createScheduleBlockResponseOpenApiSchema,
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.createForOwner.bind(scheduleBlocksController),
  );

  app.get(
    "/schedule-blocks",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Schedule Blocks (Owner)"],
        summary: "List schedule blocks for the authenticated owner's company",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            collaboratorId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: { type: "array", items: scheduleBlockOpenApiSchema },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.listForOwner.bind(scheduleBlocksController),
  );

  app.delete(
    "/schedule-blocks/:blockId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Schedule Blocks (Owner)"],
        summary: "Delete a schedule block belonging to the owner's company",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["blockId"],
          properties: { blockId: { type: "string", format: "uuid" } },
        },
        response: {
          204: { type: "null" },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.delete.bind(scheduleBlocksController),
  );

  // === Schedule Blocks (Collaborator Self-Service) ===
  app.post(
    "/me/schedule-blocks",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "Create a personal schedule block / absence for the authenticated collaborator",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["startsAt", "endsAt"],
          properties: {
            startsAt: { type: "string", format: "date-time" },
            endsAt: { type: "string", format: "date-time" },
            reason: { type: "string", maxLength: 500, nullable: true },
          },
        },
        response: {
          201: createScheduleBlockResponseOpenApiSchema,
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.createForCollaborator.bind(scheduleBlocksController),
  );

  app.get(
    "/me/schedule-blocks",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "List personal schedule blocks for the authenticated collaborator",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
          },
        },
        response: {
          200: { type: "array", items: scheduleBlockOpenApiSchema },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.listForCollaborator.bind(scheduleBlocksController),
  );

  app.delete(
    "/me/schedule-blocks/:blockId",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "Delete a personal schedule block owned by the authenticated collaborator",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["blockId"],
          properties: { blockId: { type: "string", format: "uuid" } },
        },
        response: {
          204: { type: "null" },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
        },
      },
    },
    scheduleBlocksController.delete.bind(scheduleBlocksController),
  );

  // === Public Booking & Availability ===
  app.get(
    "/public/companies/:companyId/availability",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Query available booking slots for a company, service, date, and optional collaborator",
        params: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          required: ["serviceId", "date"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
            date: { type: "string", description: "YYYY-MM-DD in company timezone" },
            collaboratorId: { type: "string", format: "uuid" },
            timezone: { type: "string" },
          },
        },
        response: {
          200: availabilityResponseOpenApiSchema,
          400: errorOpenApiSchema,
          404: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.getPublicAvailability.bind(appointmentsController),
  );

  app.post(
    "/public/companies/:companyId/appointments",
    {
      schema: {
        tags: ["Public Booking"],
        summary: "Create a public appointment without client login (starts as PENDING; endsAt derived on backend)",
        params: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["serviceId", "collaboratorId", "startsAt", "clientName", "clientPhone"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
            collaboratorId: { type: "string", format: "uuid" },
            startsAt: { type: "string", format: "date-time" },
            clientName: { type: "string", minLength: 2, maxLength: 120 },
            clientPhone: { type: "string", minLength: 10, maxLength: 30 },
          },
        },
        response: {
          201: appointmentOpenApiSchema,
          400: errorOpenApiSchema,
          404: errorOpenApiSchema,
          409: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.createPublic.bind(appointmentsController),
  );

  // === Internal Appointments Management ===
  app.post(
    "/appointments",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Appointments (Owner)"],
        summary: "Create an appointment as authenticated OWNER (COLLABORATOR forbidden; endsAt derived on backend)",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["serviceId", "collaboratorId", "startsAt", "clientName", "clientPhone"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
            collaboratorId: { type: "string", format: "uuid" },
            startsAt: { type: "string", format: "date-time" },
            clientName: { type: "string", minLength: 2, maxLength: 120 },
            clientPhone: { type: "string", minLength: 10, maxLength: 30 },
            initialStatus: { type: "string", enum: ["PENDING", "CONFIRMED"] },
          },
        },
        response: {
          201: appointmentOpenApiSchema,
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
          409: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.createInternal.bind(appointmentsController),
  );

  app.get(
    "/appointments",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Appointments (Owner)"],
        summary: "List company appointments with optional filters",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            collaboratorId: { type: "string", format: "uuid" },
            status: {
              type: "string",
              enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"],
            },
          },
        },
        response: {
          200: { type: "array", items: appointmentOpenApiSchema },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.listForOwner.bind(appointmentsController),
  );

  app.get(
    "/me/appointments",
    {
      preHandler: collaboratorGuard,
      schema: {
        tags: ["Collaborator Self-Service"],
        summary: "List only appointments assigned to the authenticated collaborator",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            status: {
              type: "string",
              enum: ["PENDING", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"],
            },
          },
        },
        response: {
          200: { type: "array", items: appointmentOpenApiSchema },
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.listForCollaborator.bind(appointmentsController),
  );

  app.patch(
    "/appointments/:appointmentId/status",
    {
      preHandler: staffGuard,
      schema: {
        tags: ["Appointments (Owner & Collaborator)"],
        summary: "Transition appointment status following domain state machine",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["appointmentId"],
          properties: { appointmentId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["status"],
          properties: {
            status: {
              type: "string",
              enum: ["CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"],
            },
            cancellationReason: { type: "string", maxLength: 500, nullable: true },
          },
        },
        response: {
          200: appointmentOpenApiSchema,
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
          409: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.updateStatus.bind(appointmentsController),
  );

  app.patch(
    "/appointments/:appointmentId/reschedule",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Appointments (Owner)"],
        summary: "Reschedule an active appointment (PENDING or CONFIRMED) atomically",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["appointmentId"],
          properties: { appointmentId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["startsAt"],
          properties: {
            startsAt: { type: "string", format: "date-time" },
            collaboratorId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: appointmentOpenApiSchema,
          400: errorOpenApiSchema,
          401: errorOpenApiSchema,
          403: errorOpenApiSchema,
          404: errorOpenApiSchema,
          409: errorOpenApiSchema,
        },
      },
    },
    appointmentsController.reschedule.bind(appointmentsController),
  );
}
