import type { FastifyInstance } from "fastify";
import { authenticate, authorizeRoles } from "../../../../../shared/http/auth/authenticate.js";
import {
  makeCollaboratorsManagementController,
  makeRegisterCollaboratorController,
  type RegisterCollaboratorControllerDependencies,
} from "../factories/make-register-collaborator-controller.js";
import {
  closeMonthAwardOpenApiSchema,
  collaboratorProfileOpenApiSchema,
  listCollaboratorsOpenApiSchema,
  registerCollaboratorOpenApiSchema,
  updateCollaboratorStatusOpenApiSchema,
} from "../schemas/collaborator-http.schemas.js";

export async function CollaboratorRoutes(
  app: FastifyInstance,
  options: RegisterCollaboratorControllerDependencies = {},
): Promise<void> {
  const registerCollaboratorController = makeRegisterCollaboratorController(options);
  const managementController = makeCollaboratorsManagementController(options);
  const ownerGuard = [authenticate, authorizeRoles("OWNER")];

  // 1. Criação de colaborador
  app.post(
    "/collaborators",
    {
      preHandler: ownerGuard,
      schema: registerCollaboratorOpenApiSchema,
    },
    registerCollaboratorController.handle.bind(registerCollaboratorController),
  );

  // 2. Listagem de colaboradores com KPIs da equipe e métricas individuais do mês
  app.get(
    "/collaborators",
    {
      preHandler: ownerGuard,
      schema: listCollaboratorsOpenApiSchema,
    },
    managementController.list.bind(managementController),
  );

  // 3. Dossiê completo do perfil para o layout Bento Grid
  app.get(
    "/collaborators/:collaboratorId/profile",
    {
      preHandler: ownerGuard,
      schema: collaboratorProfileOpenApiSchema,
    },
    managementController.getProfile.bind(managementController),
  );

  // 4. Atualização de dados cadastrais, especialidade, foto e comissão padrão
  app.patch(
    "/collaborators/:collaboratorId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Update collaborator profile, specialty, commission, and revenue goals",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.updateDetails.bind(managementController),
  );

  // 5. Upload de foto/avatar do colaborador
  app.post(
    "/collaborators/:collaboratorId/avatar",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Upload collaborator avatar image (JPEG, PNG, WEBP, max 5MB)",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.uploadAvatar.bind(managementController),
  );

  // 6. Sincronização da lista de serviços vinculados e comissões customizadas
  app.put(
    "/collaborators/:collaboratorId/services",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Synchronize collaborator services and custom commissions",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.syncServices.bind(managementController),
  );

  // 7. Sincronização da jornada semanal individual validada com o horário da empresa
  app.put(
    "/collaborators/:collaboratorId/schedule",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Synchronize collaborator weekly schedule validated against company hours",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.syncSchedule.bind(managementController),
  );

  // 8. Atualização ou definição de credenciais de acesso (email e senha)
  app.patch(
    "/collaborators/:collaboratorId/credentials",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Update collaborator login credentials (email and password)",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.updateCredentials.bind(managementController),
  );

  // 9. Consulta de agendamentos futuros para confirmação de desligamento
  app.get(
    "/collaborators/:collaboratorId/future-appointments-count",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Count active future appointments before deactivation",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.futureAppointmentsCount.bind(managementController),
  );

  // 10. Desativação lógica e enfileiramento na fila de reagendamento inteligente com IA
  app.post(
    "/collaborators/:collaboratorId/deactivate",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Deactivate collaborator and optionally queue appointments for AI rescheduling",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.deactivate.bind(managementController),
  );

  // 11. Atualização legada de status booleano (isActive)
  app.patch(
    "/collaborators/:collaboratorId/status",
    {
      preHandler: ownerGuard,
      schema: updateCollaboratorStatusOpenApiSchema,
    },
    managementController.updateStatus.bind(managementController),
  );

  // 12. Exclusão física legada (quando aplicável)
  app.delete(
    "/collaborators/:collaboratorId",
    {
      preHandler: ownerGuard,
      schema: {
        tags: ["Collaborators (Owner)"],
        summary: "Delete a collaborator if they have no linked appointments",
        security: [{ bearerAuth: [] }],
      },
    },
    managementController.remove.bind(managementController),
  );

  // 13. Fechamento do mês e premiação oficial do Funcionário do Mês (#1 do ranking)
  app.post(
    "/collaborators/awards/close-month",
    {
      preHandler: ownerGuard,
      schema: closeMonthAwardOpenApiSchema,
    },
    managementController.closeMonthAward.bind(managementController),
  );
}
