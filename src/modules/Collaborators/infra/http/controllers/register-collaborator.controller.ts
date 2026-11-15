import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { registerCollaboratorSchema } from "../../../../../shared/utils/validation-schemas.js";
import type { RegisterCollaboratorUseCase } from "../../../application/register-collaborator.usecase.js";
import { CollaboratorCompanyNotFoundError, CollaboratorEmailAlreadyInError } from "../../../application/errors/collaborator-errors.js";

export class RegisterCollaboratorController {
  constructor(private readonly registerUseCase: RegisterCollaboratorUseCase) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
    try {
      const validatedData = registerCollaboratorSchema.parse(request.body);
      const result = await this.registerUseCase.execute(validatedData);
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
