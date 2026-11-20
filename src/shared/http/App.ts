import fastify from "fastify";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { ComapnyRoutes } from "../../modules/Company/infra/http/routers/company-routes.js";
import { CollaboratorRoutes } from "../../modules/Collaborators/infra/http/routers/collaborator-routes.js";
import { servicesRoutes } from "../../modules/services/infra/http/routes/services.routes.js";
import { workSchedulesRoutes } from "../../modules/work-schedules/infra/http/routes/work-schedules.routes.js";
import { isProduction } from "../config/env.js";
import { registerErrorHandler } from "./error-handler.js";

const app = fastify({
  logger: true,
});

registerErrorHandler(app);

if (!isProduction()) {
  app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "SaaS Barberías y Salones API",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
    },
  });

  app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
  });
}

app.register(ComapnyRoutes);
app.register(CollaboratorRoutes);
app.register(servicesRoutes);
app.register(workSchedulesRoutes);

export { app };
