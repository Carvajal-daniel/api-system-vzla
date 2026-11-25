import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticate,
  authorizeRoles,
} from "../../../../shared/http/auth/authenticate.js";
import { CreateClientUseCase } from "../../application/use-cases/create-client.use-case.js";
import { GetClientByIdUseCase } from "../../application/use-cases/get-client-by-id.use-case.js";
import { ListClientsUseCase } from "../../application/use-cases/list-clients.use-case.js";
import { UpdateClientUseCase } from "../../application/use-cases/update-client.use-case.js";
import { DrizzleClientsRepository } from "../database/repositories/drizzle-clients.repository.js";

const ownerGuard = [authenticate, authorizeRoles("OWNER")];

const listQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid("ID de cliente inválido."),
});

const createClientBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().min(8).max(32),
  email: z.string().trim().max(160).nullable().optional(),
  birthDate: z.string().trim().max(20).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const updateClientBodySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    email: z.string().trim().max(160).nullable().optional(),
    birthDate: z.string().trim().max(20).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Informe ao menos um campo para atualizar.",
  });

export async function clientsRoutes(app: FastifyInstance): Promise<void> {
  const repository = new DrizzleClientsRepository();
  const listClientsUseCase = new ListClientsUseCase(repository);
  const getClientByIdUseCase = new GetClientByIdUseCase(repository);
  const createClientUseCase = new CreateClientUseCase(repository);
  const updateClientUseCase = new UpdateClientUseCase(repository);

  app.get(
    "/v1/clients",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Clients (Owner)"],
        summary: "List normalized clients isolated by companyId",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { search } = listQuerySchema.parse(request.query ?? {});
      const clients = await listClientsUseCase.execute(
        request.actor!.companyId,
        search,
      );
      return { clients };
    },
  );

  app.post(
    "/v1/clients",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Clients (Owner)"],
        summary: "Create a normalized client for the authenticated company",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const payload = createClientBodySchema.parse(request.body ?? {});
      const client = await createClientUseCase.execute({
        companyId: request.actor!.companyId,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        birthDate: payload.birthDate,
        tags: payload.tags,
        notes: payload.notes,
      });
      return reply.code(201).send({ client });
    },
  );

  app.get(
    "/v1/clients/:id",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Clients (Owner)"],
        summary: "Get a client by ID isolated by companyId",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const client = await getClientByIdUseCase.execute(
        request.actor!.companyId,
        id,
      );
      return { client };
    },
  );

  app.patch(
    "/v1/clients/:id",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Clients (Owner)"],
        summary: "Update a client isolated by companyId",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { id } = idParamSchema.parse(request.params);
      const payload = updateClientBodySchema.parse(request.body ?? {});
      const client = await updateClientUseCase.execute({
        companyId: request.actor!.companyId,
        id,
        name: payload.name,
        phone: payload.phone,
        email: payload.email,
        birthDate: payload.birthDate,
        tags: payload.tags,
        notes: payload.notes,
      });
      return { client };
    },
  );
}
