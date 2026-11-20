import { and, eq } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { CollaboratorTable } from "../../../modules/Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../modules/Company/infra/database/schema/companies-schema.js";
import type { ActorContext, ActorRole } from "../../auth/actor-context.js";
import { getJwtSecret } from "../../config/env.js";
import { db } from "../../database/database.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext | undefined;
  }
}

export type ActorStatusVerifier = (actor: ActorContext) => Promise<boolean>;

const jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  companyId: z.string().uuid(),
  role: z.enum(["OWNER", "COLLABORATOR"]),
});

// Valida no banco se a conta autenticada e a respectiva empresa continuam ativas, revogando tokens de contas desativadas.
async function defaultActorStatusVerifier(actor: ActorContext): Promise<boolean> {
  if (actor.role === "OWNER") {
    const rows = await db
      .select({ isActive: CompanyTable.isActive })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, actor.companyId))
      .limit(1);

    return rows[0]?.isActive === true;
  }

  const rows = await db
    .select({
      collaboratorIsActive: CollaboratorTable.isActive,
      companyIsActive: CompanyTable.isActive,
    })
    .from(CollaboratorTable)
    .innerJoin(CompanyTable, eq(CollaboratorTable.companyId, CompanyTable.id))
    .where(
      and(
        eq(CollaboratorTable.id, actor.collaboratorId),
        eq(CollaboratorTable.companyId, actor.companyId),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row !== undefined && row.collaboratorIsActive && row.companyIsActive;
}

let actorStatusVerifier: ActorStatusVerifier = defaultActorStatusVerifier;

export function setActorStatusVerifier(verifier: ActorStatusVerifier): void {
  actorStatusVerifier = verifier;
}

export function resetActorStatusVerifier(): void {
  actorStatusVerifier = defaultActorStatusVerifier;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({
      message: "Authentication required.",
    });
  }

  const token = authHeader.slice("Bearer ".length).trim();

  if (!token) {
    return reply.status(401).send({
      message: "Authentication required.",
    });
  }

  let actor: ActorContext;

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const parsed = jwtPayloadSchema.safeParse(decoded);

    if (!parsed.success) {
      return reply.status(401).send({
        message: "Invalid authentication token.",
      });
    }

    const { sub, companyId, role } = parsed.data;

    actor =
      role === "OWNER"
        ? { role: "OWNER", userId: sub, companyId }
        : { role: "COLLABORATOR", collaboratorId: sub, companyId };
  } catch {
    return reply.status(401).send({
      message: "Invalid or expired authentication token.",
    });
  }

  const isActorActive = await actorStatusVerifier(actor);

  if (!isActorActive) {
    return reply.status(401).send({
      message: "Session is no longer valid.",
    });
  }

  request.actor = actor;
}

export function authorizeRoles(...allowedRoles: ActorRole[]) {
  return async function roleGuard(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (!request.actor) {
      return reply.status(401).send({
        message: "Authentication required.",
      });
    }

    if (!allowedRoles.includes(request.actor.role)) {
      return reply.status(403).send({
        message: "You do not have permission to perform this action.",
      });
    }
  };
}
