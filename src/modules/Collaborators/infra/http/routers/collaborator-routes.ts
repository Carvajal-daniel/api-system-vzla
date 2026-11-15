import type { FastifyInstance } from "fastify";
import { makeRegisterCollaboratorController } from "../factories/make-register-collaborator-controller.js";

const registerCollaboratorController = makeRegisterCollaboratorController();

export async function CollaboratorRoutes(app: FastifyInstance) {
  app.post("/collaborators", registerCollaboratorController.handle.bind(registerCollaboratorController));
}
