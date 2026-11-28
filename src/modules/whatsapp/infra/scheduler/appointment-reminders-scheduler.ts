import type { FastifyInstance } from "fastify";
import { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import { DrizzleTenantUsageRepository } from "../../../billing/infra/database/repositories/drizzle-tenant-usage.repository.js";
import { ProcessAppointmentRemindersUseCase } from "../../application/use-cases/process-appointment-reminders.use-case.js";
import { WhatsAppGatewayRouter as HybridWhatsAppGatewayRouter } from "../adapters/whatsapp/whatsapp-gateway.router.js";
import { DrizzleAppointmentRemindersRepository } from "../database/repositories/drizzle-appointment-reminders.repository.js";
import { DrizzleCompanyWhatsAppConnectionRepository } from "../database/repositories/drizzle-company-whatsapp-connection.repository.js";
import { DrizzleTenantWhatsAppChannelsRepository } from "../database/repositories/drizzle-tenant-whatsapp-channels.repository.js";
import { DrizzleWhatsAppConversationsRepository } from "../database/repositories/drizzle-whatsapp-conversations.repository.js";
import { DrizzleWhatsAppMessagesRepository } from "../database/repositories/drizzle-whatsapp-messages.repository.js";

const DEFAULT_POLL_INTERVAL_MS = 2 * 60 * 1000;

// Worker periódico dedicado ao disparo real de lembretes automáticos via WhatsApp.
// Executa a cada 2 minutos (configurável por REMINDERS_POLL_INTERVAL_MS), com trava anti-concorrência,
// verificação de instância conectada e limpeza garantida no desligamento do Fastify.
export function registerAppointmentRemindersScheduler(app: FastifyInstance): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const pollIntervalMs = Math.max(
    30_000,
    Number(process.env.REMINDERS_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS),
  );

  const tenantUsageRepository = new DrizzleTenantUsageRepository();
  const planQuotaGuard = new PlanQuotaGuardUseCase(tenantUsageRepository);
  const tenantChannelsRepository = new DrizzleTenantWhatsAppChannelsRepository();
  const companyConnectionRepository = new DrizzleCompanyWhatsAppConnectionRepository();
  const hybridGateway = new HybridWhatsAppGatewayRouter(tenantChannelsRepository);
  const conversationsRepository = new DrizzleWhatsAppConversationsRepository();
  const messagesRepository = new DrizzleWhatsAppMessagesRepository();
  const remindersRepository = new DrizzleAppointmentRemindersRepository();

  const checkTenantWhatsAppConnected = async (companyId: string): Promise<boolean> => {
    const [connectedChannels, legacyConn] = await Promise.all([
      tenantChannelsRepository.listConnectedByTenant(companyId).catch(() => []),
      companyConnectionRepository.findByCompanyId(companyId).catch(() => null),
    ]);

    if (connectedChannels.length > 0) return true;

    return Boolean(
      legacyConn &&
        (legacyConn.evolutionStatus === "CONNECTED" ||
          (legacyConn.datafyEnabled && legacyConn.datafyStatus === "CONNECTED")),
    );
  };

  const processRemindersUseCase = new ProcessAppointmentRemindersUseCase(
    remindersRepository,
    conversationsRepository,
    messagesRepository,
    hybridGateway,
    planQuotaGuard,
    checkTenantWhatsAppConnected,
    {
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
    },
  );

  let running = false;
  let interval: NodeJS.Timeout | null = null;

  const runTick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await processRemindersUseCase.execute();
      if (result.sentCount > 0 || result.failedCount > 0) {
        app.log.info(
          result,
          `[RemindersScheduler] Ciclo concluído (${result.sentCount} enviado(s), ${result.failedCount} falha(s)).`,
        );
      }
    } catch (error) {
      app.log.error(error, "[RemindersScheduler] Erro inesperado no ciclo de lembretes.");
    } finally {
      running = false;
    }
  };

  app.addHook("onReady", async () => {
    interval = setInterval(() => {
      void runTick();
    }, pollIntervalMs);
    interval.unref();
    app.log.info(
      `[RemindersScheduler] Worker de lembretes automáticos WhatsApp ativo (intervalo: ${Math.round(pollIntervalMs / 1000)}s).`,
    );
  });

  app.addHook("onClose", async () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  });
}
