import fastify from "fastify";
import { ComapnyRoutes } from "../../modules/Company/infra/http/routers/company-routes.js";
import { CollaboratorRoutes } from "../../modules/Collaborators/infra/http/routers/collaborator-routes.js";

const app = fastify({
  logger: true,
});

app.register(ComapnyRoutes);
app.register(CollaboratorRoutes);

export { app };
