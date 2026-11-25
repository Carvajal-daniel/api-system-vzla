import "dotenv/config";
import { join } from "node:path";
import fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { appointmentsRoutes } from "../../modules/appointments/infra/http/routes/appointments.routes.js";
import { clientRecoveryRoutes } from "../../modules/clients/infra/http/client-recovery.routes.js";
import { clientsRoutes } from "../../modules/clients/infra/http/clients.routes.js";
import { authRoutes } from "../../modules/auth/infra/http/routes/auth.routes.js";
import { billingRoutes } from "../../modules/billing/infra/http/billing.routes.js";
import { CollaboratorRoutes } from "../../modules/Collaborators/infra/http/routers/collaborator-routes.js";
import { googlePlaceRoutes } from "../../modules/Company/infra/http/google-place.routes.js";
import { companySettingsRoutes } from "../../modules/Company/infra/http/company-settings.routes.js";
import { ComapnyRoutes } from "../../modules/Company/infra/http/routers/company-routes.js";
import { collectionRoutes } from "../../modules/finance/infra/http/routes/collection.routes.js";
import { financeRoutes } from "../../modules/finance/infra/http/routes/finance.routes.js";
import { orderRoutes } from "../../modules/finance/infra/http/routes/order.routes.js";
import { outflowRoutes } from "../../modules/finance/infra/http/routes/outflow.routes.js";
import { inventoryRoutes } from "../../modules/inventory/infra/http/inventory.routes.js";
import { servicesRoutes } from "../../modules/services/infra/http/routes/services.routes.js";
import { whatsappRoutes } from "../../modules/whatsapp/infra/http/whatsapp.routes.js";
import { workSchedulesRoutes } from "../../modules/work-schedules/infra/http/routes/work-schedules.routes.js";
import { getCorsOrigins, isProduction } from "../config/env.js";
import { registerErrorHandler } from "./error-handler.js";

const app = fastify({
  logger: true,
});

// Habilita CORS controlado por variável de ambiente para consumo seguro pelo frontend web.
app.register(fastifyCors, {
  origin: getCorsOrigins() ? getCorsOrigins() : true,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Suporte para upload de arquivos (multipart/form-data) com limite de 5MB por arquivo
app.register(fastifyMultipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
});

// Servidor de arquivos estáticos para uploads locais (ex: avatares de profissionais)
app.register(fastifyStatic, {
  root: join(process.cwd(), "uploads"),
  prefix: "/uploads/",
  decorateReply: false,
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

app.get(
  "/health",
  {
    schema: {
      tags: ["System"],
      summary: "Health check endpoint",
    },
  },
  async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
  }),
);

app.register(authRoutes);
app.register(ComapnyRoutes);
app.register(companySettingsRoutes);
app.register(googlePlaceRoutes);
app.register(CollaboratorRoutes);
app.register(servicesRoutes);
app.register(workSchedulesRoutes);
app.register(appointmentsRoutes);
app.register(financeRoutes);
app.register(collectionRoutes);
app.register(orderRoutes);
app.register(outflowRoutes);
app.register(inventoryRoutes);
app.register(clientRecoveryRoutes);
app.register(clientsRoutes);
app.register(whatsappRoutes);
app.register(billingRoutes);

export { app };
