import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { registerCollaboratorSchema } from "../../../../../shared/utils/validation-schemas.js";
import type { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import { CollaboratorCompanyNotFoundError, CollaboratorEmailAlreadyInError } from "../../../application/errors/collaborator-errors.js";

export class RegisterCollaboratorController {
  constructor(private readonly registerUseCase: RegisterCollaboratorUseCase) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    if (!request.actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    try {
      const validatedData = registerCollaboratorSchema.parse(request.body);
      // Deriva o tenant diretamente do token JWT autenticado para impedir criação em empresas de terceiros.
      const result = await this.registerUseCase.execute({
        ...validatedData,
        companyId: request.actor.companyId,
      });
      return reply.status(201).send(result);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ message: error.issues[0]?.message ?? "Dados inválidos." });
      }

      if (error instanceof CollaboratorEmailAlreadyInError) {
        return reply.status(409).send({ message: error.message });
      }

      if (error instanceof CollaboratorCompanyNotFoundError) {
        return reply.status(404).send({ message: error.message });
      }

      throw error;
    }
  }
}
