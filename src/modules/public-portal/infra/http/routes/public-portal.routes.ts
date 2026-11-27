import type { FastifyInstance } from "fastify";
import { CreateAppointmentUseCase } from "../../../../appointments/application/use-cases/create-appointment.use-case.js";
import { GetAvailabilityUseCase } from "../../../../appointments/application/use-cases/get-availability.use-case.js";
import { DrizzleAppointmentsRepository } from "../../../../appointments/infra/database/repositories/drizzle-appointments.repository.js";
import { DrizzleScheduleBlocksRepository } from "../../../../appointments/infra/database/repositories/drizzle-schedule-blocks.repository.js";
import { DrizzleSchedulingContextLookupRepository } from "../../../../appointments/infra/database/repositories/drizzle-scheduling-context-lookup.repository.js";
import { availabilityResponseOpenApiSchema } from "../../../../appointments/infra/http/schemas/appointments-http.schemas.js";
import { WaitlistUseCase } from "../../../../operations/application/waitlist.use-case.js";
import { DrizzleOperationsRepository } from "../../../../operations/infra/database/repositories/drizzle-operations.repository.js";
import { WAITLIST_SHIFTS } from "../../../../operations/infra/database/schema/operations-schema.js";
import { WhatsAppOperationsNotificationAdapter } from "../../../../operations/infra/notifications/whatsapp-operations-notification.adapter.js";
import { PaymentsRepository } from "../../../../payments/infra/database/payments.repository.js";
import { ListPublicCompanyCatalogUseCase } from "../../../../services/application/use-cases/list-public-company-catalog.use-case.js";
import { DrizzleCollaboratorLookupRepository } from "../../../../services/infra/database/repositories/drizzle-collaborator-lookup.repository.js";
import { DrizzleCollaboratorServicesRepository } from "../../../../services/infra/database/repositories/drizzle-collaborator-services.repository.js";
import { DrizzleCompanyLookupRepository } from "../../../../services/infra/database/repositories/drizzle-company-lookup.repository.js";
import { DrizzleServicesRepository } from "../../../../services/infra/database/repositories/drizzle-services.repository.js";
import type {
  PublicPortalPaymentsPort,
  PublicPortalReadPort,
} from "../../../application/ports/public-portal.port.js";
import { PublicPortalService } from "../../../application/public-portal.service.js";
import {
  DrizzlePublicPortalRepository,
  PaymentsRepositoryPublicAdapter,
} from "../../database/drizzle-public-portal.repository.js";
import {
  paymentStatusParamsSchema,
  publicAppointmentResponseOpenApiSchema,
  publicAvailabilityQuerySchema,
  publicClubSubscribeBodySchema,
  publicClubSubscribeResponseOpenApiSchema,
  publicCreateAppointmentBodySchema,
  publicErrorOpenApiSchema,
  publicIdentifyBodySchema,
  publicIdentifyResponseOpenApiSchema,
  publicPaymentStatusResponseOpenApiSchema,
  publicStorefrontResponseOpenApiSchema,
  publicWaitlistBodySchema,
  publicWaitlistResponseOpenApiSchema,
  slugParamSchema,
} from "../schemas/public-portal.schemas.js";

export interface PublicPortalRoutesDependencies {
  service?: PublicPortalService;
  readPort?: PublicPortalReadPort;
  paymentsPort?: PublicPortalPaymentsPort;
  catalogUseCase?: ListPublicCompanyCatalogUseCase;
  availabilityUseCase?: GetAvailabilityUseCase;
  createAppointmentUseCase?: CreateAppointmentUseCase;
  waitlistUseCase?: WaitlistUseCase;
  now?: () => Date;
}

function makePublicPortalService(
  deps: PublicPortalRoutesDependencies,
): PublicPortalService {
  if (deps.service) return deps.service;

  const readPort = deps.readPort ?? new DrizzlePublicPortalRepository();
  const paymentsPort =
    deps.paymentsPort ?? new PaymentsRepositoryPublicAdapter(new PaymentsRepository());

  const catalogUseCase =
    deps.catalogUseCase ??
    new ListPublicCompanyCatalogUseCase(
      new DrizzleServicesRepository(),
      new DrizzleCollaboratorServicesRepository(),
      new DrizzleCollaboratorLookupRepository(),
      new DrizzleCompanyLookupRepository(),
    );

  const lookupRepository = new DrizzleSchedulingContextLookupRepository();
  const scheduleBlocksRepository = new DrizzleScheduleBlocksRepository();
  const appointmentsRepository = new DrizzleAppointmentsRepository();

  const availabilityUseCase =
    deps.availabilityUseCase ??
    new GetAvailabilityUseCase(
      lookupRepository,
      scheduleBlocksRepository,
      appointmentsRepository,
    );

  const createAppointmentUseCase =
    deps.createAppointmentUseCase ??
    new CreateAppointmentUseCase(
      lookupRepository,
      scheduleBlocksRepository,
      appointmentsRepository,
    );

  const waitlistUseCase =
    deps.waitlistUseCase ??
    new WaitlistUseCase(
      new DrizzleOperationsRepository(),
      new WhatsAppOperationsNotificationAdapter(),
    );

  return new PublicPortalService(
    readPort,
    paymentsPort,
    catalogUseCase,
    availabilityUseCase,
    createAppointmentUseCase,
    waitlistUseCase,
  );
}

export async function publicPortalRoutes(
  app: FastifyInstance,
  deps: PublicPortalRoutesDependencies = {},
): Promise<void> {
  const service = makePublicPortalService(deps);
  const nowProvider = deps.now ?? (() => new Date());

  // 1. Vitrine Pública da Barbearia/Salão por Slug
  app.get(
    "/public/:slug",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Get public storefront data, services, barbers, deposit policy, and active club plans by company slug",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        response: {
          200: publicStorefrontResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const result = await service.getStorefront(slug);
      return reply.status(200).send(result);
    },
  );

  // 2. Disponibilidade Real de Horários
  app.get(
    "/public/:slug/availability",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Query real available booking slots for a service, date, and optional collaborator by slug",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        querystring: {
          type: "object",
          required: ["serviceId", "date"],
          properties: {
            serviceId: { type: "string", format: "uuid" },
            date: { type: "string", description: "YYYY-MM-DD in company timezone" },
            collaboratorId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: availabilityResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const query = publicAvailabilityQuerySchema.parse(request.query);
      const result = await service.getAvailability(slug, query, nowProvider());
      return reply.status(200).send(result);
    },
  );

  // 3. Identificação Segura de Cliente e Cobertura do Clube
  app.post(
    "/public/:slug/identify",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Identify customer by phone within the tenant and return active Club subscription coverage without leaking sensitive data",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        body: {
          type: "object",
          required: ["phone"],
          properties: {
            phone: { type: "string", minLength: 10, maxLength: 30 },
            name: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        response: {
          200: publicIdentifyResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const body = publicIdentifyBodySchema.parse(request.body);
      const result = await service.identifyCustomer(slug, body, nowProvider());
      return reply.status(200).send(result);
    },
  );

  // 4. Criação de Agendamento Público (Clube / Sinal Pix / Confirmação Imediata)
  app.post(
    "/public/:slug/appointments",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Create a public appointment: free & confirmed for covered club subscribers, PENDING + Pix deposit when required, or CONFIRMED immediately",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
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
            clientData: { type: "object", additionalProperties: { type: "string" } },
            document: { type: "string", description: "CPF (11 digits) or CNPJ (14 digits), optional" },
          },
        },
        response: {
          201: publicAppointmentResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
          409: publicErrorOpenApiSchema,
          422: publicErrorOpenApiSchema,
          502: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const body = publicCreateAppointmentBodySchema.parse(request.body);
      const result = await service.createAppointment(slug, body, nowProvider());
      return reply.status(201).send(result);
    },
  );

  // 5. Adesão Pública ao Clube de Assinaturas via Pix
  app.post(
    "/public/:slug/club/subscribe",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Subscribe a customer to an active Club plan and generate Pix QR Code / Copy-Paste for immediate payment",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        body: {
          type: "object",
          required: ["customerName", "customerPhone", "planId"],
          properties: {
            customerName: { type: "string", minLength: 2, maxLength: 120 },
            customerPhone: { type: "string", minLength: 10, maxLength: 30 },
            planId: { type: "string", format: "uuid" },
            document: { type: "string", description: "CPF (11 digits) or CNPJ (14 digits), optional" },
          },
        },
        response: {
          201: publicClubSubscribeResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
          409: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const body = publicClubSubscribeBodySchema.parse(request.body);
      const result = await service.subscribeClub(slug, {
        ...body,
        remoteIp: request.ip,
      });
      return reply.status(201).send(result);
    },
  );

  // 6. Entrada Pública na Fila de Espera Inteligente
  app.post(
    "/public/:slug/waitlist",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Join the smart waitlist for a desired date and preferred shift when no slots are available",
        params: {
          type: "object",
          required: ["slug"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
          },
        },
        body: {
          type: "object",
          required: ["customerName", "customerPhone", "desiredDate"],
          properties: {
            customerName: { type: "string", minLength: 2, maxLength: 120 },
            customerPhone: { type: "string", minLength: 10, maxLength: 30 },
            desiredDate: { type: "string", description: "YYYY-MM-DD" },
            collaboratorId: { type: "string", format: "uuid", nullable: true },
            preferredShift: { type: "string", enum: [...WAITLIST_SHIFTS] },
          },
        },
        response: {
          201: publicWaitlistResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug } = slugParamSchema.parse(request.params);
      const body = publicWaitlistBodySchema.parse(request.body);
      const result = await service.joinWaitlist(slug, body);
      return reply.status(201).send(result);
    },
  );

  // 7. Polling Público Seguro de Status de Pagamento Pix (isolado por tenant do slug)
  app.get(
    "/public/:slug/payments/:paymentId/status",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Poll Pix payment status for deposit or Club subscription strictly scoped to the company slug",
        params: {
          type: "object",
          required: ["slug", "paymentId"],
          properties: {
            slug: { type: "string", minLength: 2, maxLength: 120 },
            paymentId: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: publicPaymentStatusResponseOpenApiSchema,
          400: publicErrorOpenApiSchema,
          404: publicErrorOpenApiSchema,
        },
      },
    },
    async (request, reply) => {
      const { slug, paymentId } = paymentStatusParamsSchema.parse(request.params);
      const result = await service.getPaymentStatus(slug, paymentId);
      return reply.status(200).send(result);
    },
  );
}
