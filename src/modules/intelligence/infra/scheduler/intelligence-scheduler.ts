import type { FastifyInstance } from "fastify";
import { PlanQuotaGuardUseCase } from "../../../billing/application/use-cases/plan-quota-guard.use-case.js";
import { DrizzleTenantUsageRepository } from "../../../billing/infra/database/repositories/drizzle-tenant-usage.repository.js";
import { ProcessAppointmentRemindersUseCase } from "../../../whatsapp/application/use-cases/process-appointment-reminders.use-case.js";
import { ProcessPostVisitNpsUseCase } from "../../../whatsapp/application/use-cases/process-post-visit-nps.use-case.js";
import { PostVisitSurveyUseCase } from "../../../operations/application/post-visit-survey.use-case.js";
import { WaitlistUseCase } from "../../../operations/application/waitlist.use-case.js";
import { DrizzleOperationsRepository } from "../../../operations/infra/database/repositories/drizzle-operations.repository.js";
import { WhatsAppOperationsNotificationAdapter } from "../../../operations/infra/notifications/whatsapp-operations-notification.adapter.js";
import { WhatsAppGatewayRouter as HybridWhatsAppGatewayRouter } from "../../../whatsapp/infra/adapters/whatsapp/whatsapp-gateway.router.js";
import { DrizzleAppointmentRemindersRepository } from "../../../whatsapp/infra/database/repositories/drizzle-appointment-reminders.repository.js";
import { DrizzlePostVisitNpsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-post-visit-nps.repository.js";
import { DrizzleProactiveInsightsWriter } from "../../../whatsapp/infra/database/repositories/drizzle-proactive-insights.writer.js";
import { DrizzleTenantWhatsAppChannelsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-tenant-whatsapp-channels.repository.js";
import { DrizzleWhatsAppConversationsRepository } from "../../../whatsapp/infra/database/repositories/drizzle-whatsapp-conversations.repository.js";
import { DrizzleWhatsAppMessagesRepository } from "../../../whatsapp/infra/database/repositories/drizzle-whatsapp-messages.repository.js";
import { GenerateDailyOwnerBriefingUseCase } from "../../application/use-cases/generate-daily-owner-briefing.use-case.js";
import { ProactiveIntelligenceUseCase } from "../../application/use-cases/proactive-intelligence.use-case.js";
import { RetentionClassifierUseCase } from "../../application/use-cases/retention-classifier.use-case.js";
import { GeminiIntelligenceAdapter } from "../ai/gemini-intelligence.adapter.js";
import { DrizzleIntelligenceDataRepository } from "../database/repositories/drizzle-intelligence-data.repository.js";
import { DrizzleProactiveInsightsRepository } from "../database/repositories/drizzle-proactive-insights.repository.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const SCHEDULER_TIMEZONE = "America/Sao_Paulo";

interface LocalClockSnapshot {
  dateKey: string;
  hour: number;
  minute: number;
}

export function getSaoPauloClock(now: Date = new Date()): LocalClockSnapshot {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

// Agendador interno leve e resiliente ligado ao ciclo de vida do servidor Fastify.
// Desativado automaticamente em NODE_ENV === 'test', com trava anti-concorrência e idempotência diária.
export function registerIntelligenceScheduler(app: FastifyInstance): void {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const dataRepository = new DrizzleIntelligenceDataRepository();
  const insightsRepository = new DrizzleProactiveInsightsRepository();
  const aiAdapter = new GeminiIntelligenceAdapter();
  const tenantUsageRepository = new DrizzleTenantUsageRepository();
  const planQuotaGuard = new PlanQuotaGuardUseCase(tenantUsageRepository);
  const tenantChannelsRepository =
    new DrizzleTenantWhatsAppChannelsRepository();
  const hybridGateway = new HybridWhatsAppGatewayRouter(
    tenantChannelsRepository,
  );
  const conversationsRepository = new DrizzleWhatsAppConversationsRepository();
  const messagesRepository = new DrizzleWhatsAppMessagesRepository();
  const remindersRepository = new DrizzleAppointmentRemindersRepository();
  const postVisitNpsRepository = new DrizzlePostVisitNpsRepository();
  const proactiveInsightsWriter = new DrizzleProactiveInsightsWriter();

  const processRemindersUseCase = new ProcessAppointmentRemindersUseCase(
    remindersRepository,
    conversationsRepository,
    messagesRepository,
    hybridGateway,
    planQuotaGuard,
  );
  const processPostVisitNpsUseCase = new ProcessPostVisitNpsUseCase(
    postVisitNpsRepository,
    conversationsRepository,
    messagesRepository,
    hybridGateway,
    planQuotaGuard,
    proactiveInsightsWriter,
  );
  const operationsRepository = new DrizzleOperationsRepository();
  const operationsNotificationAdapter = new WhatsAppOperationsNotificationAdapter(
    hybridGateway,
  );
  const postVisitSurveyUseCase = new PostVisitSurveyUseCase(
    operationsRepository,
    operationsNotificationAdapter,
  );
  const waitlistUseCase = new WaitlistUseCase(
    operationsRepository,
    operationsNotificationAdapter,
  );
  const proactiveIntelligenceUseCase = new ProactiveIntelligenceUseCase(
    dataRepository,
    insightsRepository,
    aiAdapter,
    hybridGateway,
    planQuotaGuard,
  );
  const dailyBriefingUseCase = new GenerateDailyOwnerBriefingUseCase(
    dataRepository,
    hybridGateway,
    planQuotaGuard,
  );
  const retentionClassifierUseCase = new RetentionClassifierUseCase(
    dataRepository,
    insightsRepository,
    aiAdapter,
    hybridGateway,
    planQuotaGuard,
    conversationsRepository,
    messagesRepository,
  );

  const inFlightJobs = new Set<string>();
  const lastRunDateByJob = new Map<string, string>();

  const runWithLock = async (
    jobName: string,
    fn: () => Promise<void>,
  ): Promise<void> => {
    if (inFlightJobs.has(jobName)) {
      return;
    }
    inFlightJobs.add(jobName);
    try {
      await fn();
    } catch (error) {
      app.log.error(error, `[Scheduler] Falha ao executar job "${jobName}"`);
    } finally {
      inFlightJobs.delete(jobName);
    }
  };

  const runEvery15Minutes = async (): Promise<void> => {
    await runWithLock("reminders_and_nps", async () => {
      await processRemindersUseCase.execute();
      await processPostVisitNpsUseCase.dispatchPendingSurveys();
      await postVisitSurveyUseCase.dispatchDueSurveys();
      await waitlistUseCase.expireStaleOffersAndNotifyNext();
    });
  };

  const checkDailyJobs = async (): Promise<void> => {
    const clock = getSaoPauloClock();

    // 08:00 (America/Sao_Paulo): Motor Proativo de Insights seguido do Briefing Diário do Dono.
    if (
      clock.hour === 8 &&
      clock.minute >= 0 &&
      lastRunDateByJob.get("morning_insights_and_briefing") !== clock.dateKey
    ) {
      lastRunDateByJob.set("morning_insights_and_briefing", clock.dateKey);
      await runWithLock("morning_insights_and_briefing", async () => {
        const tenantIds = await dataRepository.listActiveTenantIds();
        for (const tenantId of tenantIds) {
          try {
            await proactiveIntelligenceUseCase.refreshForTenant(tenantId);
            await dailyBriefingUseCase.executeForTenant(tenantId);
          } catch (error) {
            app.log.error(
              error,
              `[Scheduler] Erro no ciclo matinal (insights + briefing) para tenant ${tenantId}`,
            );
          }
        }
      });
    }

    // 10:00 (America/Sao_Paulo): Varredura de Resgate de Clientes Sumidos em 3 Trilhas.
    if (
      clock.hour === 10 &&
      clock.minute >= 0 &&
      lastRunDateByJob.get("daily_retention_rescue") !== clock.dateKey
    ) {
      lastRunDateByJob.set("daily_retention_rescue", clock.dateKey);
      await runWithLock("daily_retention_rescue", async () => {
        const tenantIds = await dataRepository.listActiveTenantIds();
        for (const tenantId of tenantIds) {
          try {
            await retentionClassifierUseCase.executeForTenant(tenantId);
          } catch (error) {
            app.log.error(
              error,
              `[Scheduler] Erro no resgate de retenção para tenant ${tenantId}`,
            );
          }
        }
      });
    }
  };

  let interval15m: NodeJS.Timeout | null = null;
  let intervalDailyTick: NodeJS.Timeout | null = null;

  app.addHook("onReady", async () => {
    interval15m = setInterval(() => {
      void runEvery15Minutes();
    }, FIFTEEN_MINUTES_MS);
    interval15m.unref();

    intervalDailyTick = setInterval(() => {
      void checkDailyJobs();
    }, ONE_MINUTE_MS);
    intervalDailyTick.unref();

    app.log.info(
      "[Scheduler] Agendador interno de Inteligência e WhatsApp ativo (America/Sao_Paulo: 08:00 insights+briefing, 10:00 retenção, 15m lembretes+NPS).",
    );
  });

  app.addHook("onClose", async () => {
    if (interval15m) {
      clearInterval(interval15m);
      interval15m = null;
    }
    if (intervalDailyTick) {
      clearInterval(intervalDailyTick);
      intervalDailyTick = null;
    }
  });
}
