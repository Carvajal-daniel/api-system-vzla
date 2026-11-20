import type { FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { ActorContext, ActorRole } from "../../auth/actor-context.js";
import { getJwtSecret } from "../../config/env.js";

declare module "fastify" {
  interface FastifyRequest {
    actor?: ActorContext | undefined;
  }
}

const jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  companyId: z.string().uuid(),
  role: z.enum(["OWNER", "COLLABORATOR"]),
});

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

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const parsed = jwtPayloadSchema.safeParse(decoded);

    if (!parsed.success) {
      return reply.status(401).send({
        message: "Invalid authentication token.",
      });
    }

    const { sub, companyId, role } = parsed.data;

    request.actor =
      role === "OWNER"
        ? { role: "OWNER", userId: sub, companyId }
        : { role: "COLLABORATOR", collaboratorId: sub, companyId };
  } catch {
    return reply.status(401).send({
      message: "Invalid or expired authentication token.",
    });
  }
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
