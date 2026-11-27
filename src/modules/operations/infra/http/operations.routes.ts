import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticate,
  authorizeRoles,
} from "../../../../shared/http/auth/authenticate.js";
import {
  ALLOWED_CASCADE_DELAY_MINUTES,
  CascadeDelayUseCase,
} from "../../application/cascade-delay.use-case.js";
import { ChurnRadarUseCase } from "../../application/churn-radar.use-case.js";
import { EmergencyAbsenceUseCase } from "../../application/emergency-absence.use-case.js";
import type { OperationsNotificationPort } from "../../application/ports/operations-notification.port.js";
import { WaitlistUseCase } from "../../application/waitlist.use-case.js";
import { DrizzleOperationsRepository } from "../database/repositories/drizzle-operations.repository.js";
import {
  WAITLIST_SHIFTS,
  WAITLIST_STATUSES,
} from "../database/schema/operations-schema.js";
import { WhatsAppOperationsNotificationAdapter } from "../notifications/whatsapp-operations-notification.adapter.js";

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

const cascadeDelayBodySchema = z.object({
  collaboratorId: z.uuid(),
  date: z.string().regex(isoDateRegex, "Date must be YYYY-MM-DD"),
  delayMinutes: z.union([z.literal(15), z.literal(30), z.literal(45)]),
});

const emergencyAbsenceParamsSchema = z.object({
  id: z.uuid(),
});

const emergencyAbsenceBodySchema = z.object({
  date: z.string().regex(isoDateRegex, "Date must be YYYY-MM-DD"),
  reason: z.string().trim().max(500).optional(),
});

const addWaitlistBodySchema = z.object({
  clientId: z.uuid(),
  collaboratorId: z.uuid().nullable().optional(),
  desiredDate: z.string().regex(isoDateRegex, "desiredDate must be YYYY-MM-DD"),
  preferredShift: z.enum(WAITLIST_SHIFTS).default("ANY"),
});

const listWaitlistQuerySchema = z.object({
  date: z.string().regex(isoDateRegex).optional(),
  status: z.enum(WAITLIST_STATUSES).optional(),
});

const churnRadarQuerySchema = z.object({
  marginDays: z.coerce.number().int().min(1).max(60).optional(),
});

const reactivateParamsSchema = z.object({
  clientId: z.uuid(),
});

const reactivateBodySchema = z.object({
  customMessage: z.string().trim().min(5).max(1500).optional(),
  marginDays: z.coerce.number().int().min(1).max(60).optional(),
});

const listOwnerAlertsQuerySchema = z.object({
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const alertIdParamsSchema = z.object({
  alertId: z.uuid(),
});

export interface OperationsRoutesDependencies {
  repository?: DrizzleOperationsRepository;
  notificationPort?: OperationsNotificationPort;
}

export async function operationsRoutes(
  app: FastifyInstance,
  deps: OperationsRoutesDependencies = {},
): Promise<void> {
  const repository = deps.repository ?? new DrizzleOperationsRepository();
  const notificationPort =
    deps.notificationPort ?? new WhatsAppOperationsNotificationAdapter();

  const cascadeDelayUseCase = new CascadeDelayUseCase(
    repository,
    notificationPort,
  );
  const emergencyAbsenceUseCase = new EmergencyAbsenceUseCase(
    repository,
    notificationPort,
  );
  const waitlistUseCase = new WaitlistUseCase(repository, notificationPort);
  const churnRadarUseCase = new ChurnRadarUseCase(repository, notificationPort);

  const ownerGuard = [authenticate, authorizeRoles("OWNER")];
  const staffGuard = [authenticate, authorizeRoles("OWNER", "COLLABORATOR")];

  // 1. Atraso em Cascata
  app.post(
    "/appointments/cascade-delay",
    {
      preHandler: staffGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary:
          "Shift future PENDING/CONFIRMED appointments of a collaborator on a date by 15/30/45 min and notify affected clients via L0 WhatsApp",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["collaboratorId", "date", "delayMinutes"],
          properties: {
            collaboratorId: { type: "string", format: "uuid" },
            date: { type: "string", description: "YYYY-MM-DD" },
            delayMinutes: {
              type: "integer",
              enum: [...ALLOWED_CASCADE_DELAY_MINUTES],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = cascadeDelayBodySchema.parse(request.body);
      const result = await cascadeDelayUseCase.execute({
        actor: request.actor!,
        collaboratorId: body.collaboratorId,
        date: body.date,
        delayMinutes: body.delayMinutes,
      });
      return reply.status(200).send(result);
    },
  );

  // 2. Modo Imprevisto
  app.post(
    "/collaborators/:id/emergency-absence",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary:
          "Block collaborator schedule for a day, find compatible alternatives with other barbers, notify clients via WhatsApp, and create an owner alert",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["date"],
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            reason: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = emergencyAbsenceParamsSchema.parse(request.params);
      const body = emergencyAbsenceBodySchema.parse(request.body);
      const result = await emergencyAbsenceUseCase.execute({
        actor: request.actor!,
        collaboratorId: id,
        date: body.date,
        reason: body.reason,
      });
      return reply.status(200).send(result);
    },
  );

  // 3. Fila de Espera Inteligente
  app.post(
    "/waitlist",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary: "Add a client to the smart waitlist for a desired date and shift",
        security: [{ bearerAuth: [] }],
        body: {
          type: "object",
          required: ["clientId", "desiredDate"],
          properties: {
            clientId: { type: "string", format: "uuid" },
            collaboratorId: { type: "string", format: "uuid", nullable: true },
            desiredDate: { type: "string", description: "YYYY-MM-DD" },
            preferredShift: { type: "string", enum: [...WAITLIST_SHIFTS] },
          },
        },
      },
    },
    async (request, reply) => {
      const body = addWaitlistBodySchema.parse(request.body);
      const entry = await waitlistUseCase.addEntry({
        actor: request.actor!,
        clientId: body.clientId,
        collaboratorId: body.collaboratorId ?? null,
        desiredDate: body.desiredDate,
        preferredShift: body.preferredShift,
      });
      return reply.status(201).send(entry);
    },
  );

  app.get(
    "/waitlist",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary: "List smart waitlist entries for a day (defaults to today in company timezone)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            date: { type: "string", description: "YYYY-MM-DD" },
            status: { type: "string", enum: [...WAITLIST_STATUSES] },
          },
        },
      },
    },
    async (request, reply) => {
      const query = listWaitlistQuerySchema.parse(request.query ?? {});
      const result = await waitlistUseCase.listDayEntries({
        actor: request.actor!,
        date: query.date,
        status: query.status,
      });
      return reply.status(200).send(result);
    },
  );

  // 4. Radar de Churn Individual e Reativação
  app.get(
    "/retention/churn-radar",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary:
          "Compute individual churn radar based on each client's real average cycle between completed visits (min 2 visits)",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            marginDays: { type: "integer", minimum: 1, maximum: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      const query = churnRadarQuerySchema.parse(request.query ?? {});
      const result = await churnRadarUseCase.getRadar({
        actor: request.actor!,
        marginDays: query.marginDays,
      });
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/retention/churn-radar/:clientId/reactivate",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary:
          "Send a personalized WhatsApp reactivation invite to a client flagged in the individual churn radar",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["clientId"],
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          properties: {
            customMessage: { type: "string", minLength: 5, maxLength: 1500 },
            marginDays: { type: "integer", minimum: 1, maximum: 60 },
          },
        },
      },
    },
    async (request, reply) => {
      const { clientId } = reactivateParamsSchema.parse(request.params);
      const body = reactivateBodySchema.parse(request.body ?? {});
      const result = await churnRadarUseCase.sendReactivationInvite({
        actor: request.actor!,
        clientId,
        customMessage: body.customMessage,
        marginDays: body.marginDays,
      });
      return reply.status(200).send(result);
    },
  );

  // 5. Alertas do Dono (acompanhamento de reputação, modo imprevisto e churn)
  app.get(
    "/owner-alerts",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary: "List owner operational and reputation alerts",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            unreadOnly: { type: "string", enum: ["true", "false"] },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const query = listOwnerAlertsQuerySchema.parse(request.query ?? {});
      const alerts = await repository.listOwnerAlerts({
        companyId: request.actor!.companyId,
        unreadOnly: query.unreadOnly,
        limit: query.limit,
      });
      return reply.status(200).send({ alerts });
    },
  );

  app.patch(
    "/owner-alerts/:alertId/read",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Operations & Retention"],
        summary: "Mark an owner alert as read",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["alertId"],
          properties: { alertId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { alertId } = alertIdParamsSchema.parse(request.params);
      const updated = await repository.markOwnerAlertRead(
        request.actor!.companyId,
        alertId,
      );
      if (!updated) {
        return reply.status(404).send({ message: "Alert not found." });
      }
      return reply.status(200).send({ id: alertId, isRead: true });
    },
  );
}
