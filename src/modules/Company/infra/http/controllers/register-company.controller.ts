
import type { FastifyRequest, FastifyReply } from "fastify";
import type { RegisterCompanyUseCase } from "../../../application/register-company.usecase.js";
import { registerCompanySchema } from "../../../../../shared/utils/validation-schemas.js";
import { ZodError } from "zod";

export class RegisterCompanyController {
  constructor(private readonly registerUseCase: RegisterCompanyUseCase) {}

  async handle(request: FastifyRequest, reply: FastifyReply) {
 
    try {
          const validatedData = registerCompanySchema.parse(request.body);

   
          const result = await this.registerUseCase.execute(validatedData);

          return reply.status(201).send(result); 

    }catch (error) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      message: 'Dados inválidos',
      errors: error.issues,
    });
  }

  throw error;
}
    }



  
}
