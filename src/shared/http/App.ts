import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { authRoutes } from "../../modules/auth/infra/http/routes/auth.routes.js";
import { ComapnyRoutes } from "../../modules/Company/infra/http/routers/company-routes.js";
import { CollaboratorRoutes } from "../../modules/Collaborators/infra/http/routers/collaborator-routes.js";
import { servicesRoutes } from "../../modules/services/infra/http/routes/services.routes.js";
import { workSchedulesRoutes } from "../../modules/work-schedules/infra/http/routes/work-schedules.routes.js";
import { appointmentsRoutes } from "../../modules/appointments/infra/http/routes/appointments.routes.js";
import { financeRoutes } from "../../modules/finance/infra/http/routes/finance.routes.js";
import { getCorsOrigins, isProduction } from "../config/env.js";
import { registerErrorHandler } from "./error-handler.js";

const app = fastify({
  logger: true,
});

// Habilita CORS controlado por variável de ambiente para consumo seguro pelo frontend web.
app.register(fastifyCors, {
  origin: getCorsOrigins() ? getCorsOrigins() : true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
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

app.register(authRoutes);
app.register(ComapnyRoutes);
app.register(CollaboratorRoutes);
app.register(servicesRoutes);
app.register(workSchedulesRoutes);
app.register(appointmentsRoutes);
app.register(financeRoutes);

export { app };
