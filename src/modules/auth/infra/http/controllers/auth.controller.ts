import type { FastifyReply, FastifyRequest } from "fastify";
import type { PasswordHasher } from "../../../../../shared/cryptography/password-hasher.js";
import type { GetAuthenticatedProfileUseCase } from "../../../application/use-cases/get-authenticated-profile.use-case.js";
import type { LoginUseCase } from "../../../application/use-cases/login.use-case.js";
import type { RegisterOwnerUseCase } from "../../../application/use-cases/register-owner.use-case.js";
import type { AuthIdentityRepository } from "../../../domain/repositories/auth-identity.repository.js";
import {
  loginBodySchema,
  registerOwnerBodySchema,
  updatePasswordBodySchema,
  updateProfileBodySchema,
} from "../schemas/auth-http.schemas.js";

export class AuthController {
  constructor(
    private readonly registerOwnerUseCase: RegisterOwnerUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly getAuthenticatedProfileUseCase: GetAuthenticatedProfileUseCase,
    private readonly authIdentityRepository?: AuthIdentityRepository,
    private readonly passwordHasher?: PasswordHasher,
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

  async updateProfile(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }
    if (!this.authIdentityRepository) {
      return reply.status(501).send({ message: "Profile update is not configured." });
    }

    const body = updateProfileBodySchema.parse(request.body);

    if (actor.role === "OWNER") {
      if (!this.authIdentityRepository.updateOwnerProfile) {
        return reply.status(501).send({ message: "Profile update is not supported." });
      }
      await this.authIdentityRepository.updateOwnerProfile(actor.companyId, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
        ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
      });
    } else {
      if (!this.authIdentityRepository.updateCollaboratorProfile) {
        return reply.status(501).send({ message: "Profile update is not supported." });
      }
      await this.authIdentityRepository.updateCollaboratorProfile(
        actor.collaboratorId,
        actor.companyId,
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
        },
      );
    }

    const updated = await this.getAuthenticatedProfileUseCase.execute(actor);
    return reply.status(200).send(updated);
  }

  async updatePassword(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }
    if (!this.authIdentityRepository || !this.passwordHasher) {
      return reply.status(501).send({ message: "Password update is not configured." });
    }

    const { currentPassword, newPassword } = updatePasswordBodySchema.parse(request.body);

    if (actor.role === "OWNER") {
      const owner = await this.authIdentityRepository.findOwnerById(actor.companyId);
      if (!owner || !owner.isActive) {
        return reply.status(404).send({ message: "Account not found." });
      }
      const valid = await this.passwordHasher.compare(currentPassword, owner.passwordHash);
      if (!valid) {
        return reply.status(400).send({ message: "Current password is incorrect." });
      }
      const newHash = await this.passwordHasher.hash(newPassword);
      await this.authIdentityRepository.updateOwnerPassword?.(actor.companyId, newHash);
    } else {
      const collaborator = await this.authIdentityRepository.findCollaboratorById(
        actor.collaboratorId,
        actor.companyId,
      );
      if (!collaborator || !collaborator.isActive) {
        return reply.status(404).send({ message: "Account not found." });
      }
      const valid = await this.passwordHasher.compare(currentPassword, collaborator.passwordHash);
      if (!valid) {
        return reply.status(400).send({ message: "Current password is incorrect." });
      }
      const newHash = await this.passwordHasher.hash(newPassword);
      await this.authIdentityRepository.updateCollaboratorPassword?.(
        actor.collaboratorId,
        actor.companyId,
        newHash,
      );
    }

    return reply.status(204).send();
  }
}
