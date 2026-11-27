import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../Errors/app-errors.js";
import { DomainError, type DomainErrorCode } from "../Errors/domain-error.js";

const DOMAIN_ERROR_STATUS_MAP: Record<DomainErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  BAD_GATEWAY: 502,
};

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: error.issues[0]?.message ?? "Invalid request payload.",
      });
    }

    if (error instanceof DomainError) {
      const statusCode = DOMAIN_ERROR_STATUS_MAP[error.code];
      return reply.status(statusCode).send(
        error.reasonCode
          ? { code: error.reasonCode, message: error.message }
          : { message: error.message },
      );
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        message: error.message,
      });
    }

    if ("statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        message: error.message,
      });
    }

    request.log.error(error);

    return reply.status(500).send({
      message: "Internal server error.",
    });
  });
}

export async function UserAppErrors(app: FastifyInstance): Promise<void> {
  registerErrorHandler(app);
}
