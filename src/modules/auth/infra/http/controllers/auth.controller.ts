import type { FastifyReply, FastifyRequest } from "fastify";
import type { GetAuthenticatedProfileUseCase } from "../../../application/use-cases/get-authenticated-profile.use-case.js";
import type { LoginUseCase } from "../../../application/use-cases/login.use-case.js";
import type { RegisterOwnerUseCase } from "../../../application/use-cases/register-owner.use-case.js";
import { loginBodySchema, registerOwnerBodySchema } from "../schemas/auth-http.schemas.js";

export class AuthController {
  constructor(
    private readonly registerOwnerUseCase: RegisterOwnerUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly getAuthenticatedProfileUseCase: GetAuthenticatedProfileUseCase,
  ) {}

  async register(request: FastifyRequest, reply: FastifyReply) {
    const body = registerOwnerBodySchema.parse(request.body);
    const result = await this.registerOwnerUseCase.execute(body);
    return reply.status(201).send(result);
  }

  async login(request: FastifyRequest, reply: FastifyReply) {
    const body = loginBodySchema.parse(request.body);
    const result = await this.loginUseCase.execute(body);
    return reply.status(200).send(result);
  }

  async me(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const profile = await this.getAuthenticatedProfileUseCase.execute(actor);
    return reply.status(200).send(profile);
  }
}
