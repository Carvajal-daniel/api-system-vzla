import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { db } from "../../../../shared/database/database.js";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { CreateAppointmentUseCase } from "../../../appointments/application/use-cases/create-appointment.use-case.js";
import { GetAvailabilityUseCase } from "../../../appointments/application/use-cases/get-availability.use-case.js";
import { SubscriptionPlanTable } from "../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { AppointmentPolicyError } from "../../../appointments/domain/services/appointment-policy.service.js";
import { RescheduleAppointmentUseCase } from "../../../appointments/application/use-cases/reschedule-appointment.use-case.js";
import { UpdateAppointmentStatusUseCase } from "../../../appointments/application/use-cases/update-appointment-status.use-case.js";
import { AppointmentTimeConflictError } from "../../../appointments/domain/errors/appointment-errors.js";
import {
  getLocalDateTimeParts,
  localDateTimeToUtc,
} from "../../../appointments/domain/services/timezone-utils.js";
import { DrizzleAppointmentsRepository } from "../../../appointments/infra/database/repositories/drizzle-appointments.repository.js";
import { DrizzleScheduleBlocksRepository } from "../../../appointments/infra/database/repositories/drizzle-schedule-blocks.repository.js";
import { DrizzleSchedulingContextLookupRepository } from "../../../appointments/infra/database/repositories/drizzle-scheduling-context-lookup.repository.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { WhatsAppConversationsTable } from "../database/schema/whatsapp-conversations-schema.js";
import { CollaboratorTable } from "../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import { CompanySettingsTable } from "../../../Company/infra/database/schema/company-settings-schema.js";
import { CollaboratorServiceTable } from "../../../services/infra/database/schema/collaborator-services-schema.js";
import { ServiceTable } from "../../../services/infra/database/schema/services-schema.js";
import type {
  AiBookingCollaboratorSummary,
  AiBookingCompanyContext,
  AiBookingCustomerAppointment,
  AiBookingCustomerContext,
  AiBookingOperationalRules,
  AiBookingServiceCategoryGroup,
  AiBookingServiceSummary,
  AiBookingSubscriptionPlansResult,
  AiBookingToolExecutor,
} from "../../application/ports/ai-booking-agent.port.js";
import type { AiBookingContextProviderPort } from "../../application/ports/ai-booking-context-provider.port.js";
import {
  groupServicesByCategory,
  inferServiceCategory,
  isSubscriptionPlanService,
  resolveCustomerDisplayName,
  sanitizeCustomerName,
} from "./ai-booking-tool-definitions.js";

function normalizeCustomerPhone(rawPhone: string): string | null {
  try {
    return Phone.create(rawPhone).value.replace(/^\+/, "");
  } catch {
    return null;
  }
}

const HABITUAL_WEEKDAY_LABELS: Record<number, string> = {
  0: "aos domingos",
  1: "às segundas-feiras",
  2: "às terças-feiras",
  3: "às quartas-feiras",
  4: "às quintas-feiras",
  5: "às sextas-feiras",
  6: "aos sábados",
};

export interface CustomerVisitHistoryRow {
  serviceName: string;
  collaboratorName: string;
  startsAt: Date;
  status: string;
}

export interface CustomerVisitHistorySummary {
  isNewCustomer: boolean;
  totalVisits: number;
  mostFrequentServiceName: string | null;
  preferredCollaboratorName: string | null;
  lastCompletedVisit: {
    localDate: string;
    serviceName: string;
    collaboratorName: string;
  } | null;
  habitualWeekday: string | null;
}

// Resume o histórico de atendimentos concluídos/agendados do cliente para diferenciar clientes novos
// de recorrentes e detectar serviço mais frequente, profissional preferido e dia habitual (2+ visitas).
export function summarizeCustomerVisitHistory(
  rows: CustomerVisitHistoryRow[],
  timezone: string,
): CustomerVisitHistorySummary {
  if (rows.length === 0) {
    return {
      isNewCustomer: true,
      totalVisits: 0,
      mostFrequentServiceName: null,
      preferredCollaboratorName: null,
      lastCompletedVisit: null,
      habitualWeekday: null,
    };
  }

  // Como a consulta vem ordenada do mais recente para o mais antigo, empates preservam o atendimento mais recente.
  const serviceFreq = new Map<string, number>();
  const collaboratorFreq = new Map<string, number>();
  const weekdayFreq = new Map<number, number>();

  for (const row of rows) {
    serviceFreq.set(row.serviceName, (serviceFreq.get(row.serviceName) ?? 0) + 1);
    collaboratorFreq.set(
      row.collaboratorName,
      (collaboratorFreq.get(row.collaboratorName) ?? 0) + 1,
    );
    const localParts = getLocalDateTimeParts(row.startsAt, timezone);
    weekdayFreq.set(
      localParts.dayOfWeek,
      (weekdayFreq.get(localParts.dayOfWeek) ?? 0) + 1,
    );
  }

  let mostFrequentServiceName: string | null = null;
  let bestServiceCount = 0;
  for (const [serviceName, count] of serviceFreq.entries()) {
    if (count > bestServiceCount) {
      bestServiceCount = count;
      mostFrequentServiceName = serviceName;
    }
  }

  let preferredCollaboratorName: string | null = null;
  let bestCollaboratorCount = 0;
  for (const [collaboratorName, count] of collaboratorFreq.entries()) {
    if (count > bestCollaboratorCount) {
      bestCollaboratorCount = count;
      preferredCollaboratorName = collaboratorName;
    }
  }

  let habitualWeekday: string | null = null;
  // Exige repetição de 2 ou mais atendimentos no mesmo dia da semana para apontar hábito.
  let bestWeekdayCount = 1;
  for (const [dayOfWeek, count] of weekdayFreq.entries()) {
    if (count > bestWeekdayCount) {
      bestWeekdayCount = count;
      habitualWeekday = HABITUAL_WEEKDAY_LABELS[dayOfWeek] ?? null;
    }
  }

  const latestVisit =
    rows.find((row) => row.status === "COMPLETED") ?? rows[0] ?? null;

  return {
    isNewCustomer: false,
    totalVisits: rows.length,
    mostFrequentServiceName,
    preferredCollaboratorName,
    lastCompletedVisit: latestVisit
      ? {
          localDate: getLocalDateTimeParts(latestVisit.startsAt, timezone)
            .dateString,
          serviceName: latestVisit.serviceName,
          collaboratorName: latestVisit.collaboratorName,
        }
      : null,
    habitualWeekday,
  };
}

// Provedor de contexto da empresa e adaptador de ferramentas que conecta o agente de IA
// diretamente aos casos de uso reais da agenda com actorSource: 'WHATSAPP_AI'.
export class DrizzleAiBookingContextProvider
  implements AiBookingContextProviderPort
{
  private readonly lookupRepository =
    new DrizzleSchedulingContextLookupRepository();
  private readonly scheduleBlocksRepository =
    new DrizzleScheduleBlocksRepository();
  private readonly appointmentsRepository = new DrizzleAppointmentsRepository();

  private readonly getAvailabilityUseCase = new GetAvailabilityUseCase(
    this.lookupRepository,
    this.scheduleBlocksRepository,
    this.appointmentsRepository,
  );
  private readonly createAppointmentUseCase = new CreateAppointmentUseCase(
    this.lookupRepository,
    this.scheduleBlocksRepository,
    this.appointmentsRepository,
  );
  private readonly rescheduleAppointmentUseCase =
    new RescheduleAppointmentUseCase(
      this.lookupRepository,
      this.scheduleBlocksRepository,
      this.appointmentsRepository,
    );
  private readonly updateAppointmentStatusUseCase =
    new UpdateAppointmentStatusUseCase(this.appointmentsRepository);

  private async loadCatalog(companyId: string): Promise<{
    services: AiBookingServiceSummary[];
    servicesByCategory: AiBookingServiceCategoryGroup[];
    collaborators: AiBookingCollaboratorSummary[];
    subscriptionPlans: AiBookingSubscriptionPlansResult;
  }> {
    const [servicesRows, collaboratorsRows, linksRows, popularityRows, settingsRows, clubPlans] =
      await Promise.all([
        db
          .select({
            id: ServiceTable.id,
            name: ServiceTable.name,
            description: ServiceTable.description,
            durationMinutes: ServiceTable.durationMinutes,
            priceInCents: ServiceTable.priceInCents,
          })
          .from(ServiceTable)
          .where(
            and(
              eq(ServiceTable.companyId, companyId),
              eq(ServiceTable.active, true),
            ),
          )
          .orderBy(asc(ServiceTable.name)),
        db
          .select({
            id: CollaboratorTable.id,
            name: CollaboratorTable.name,
            specialty: CollaboratorTable.specialty,
          })
          .from(CollaboratorTable)
          .where(
            and(
              eq(CollaboratorTable.companyId, companyId),
              eq(CollaboratorTable.isActive, true),
            ),
          ),
        db
          .select({
            collaboratorId: CollaboratorServiceTable.collaboratorId,
            serviceId: CollaboratorServiceTable.serviceId,
          })
          .from(CollaboratorServiceTable)
          .where(eq(CollaboratorServiceTable.companyId, companyId)),
        // Ordena o catálogo priorizando os serviços mais agendados da empresa para compor o Top 3.
        db
          .select({
            serviceId: AppointmentTable.serviceId,
            totalBookings: sql<number>`count(*)::int`,
          })
          .from(AppointmentTable)
          .where(
            and(
              eq(AppointmentTable.companyId, companyId),
              inArray(AppointmentTable.status, ["COMPLETED", "CONFIRMED", "PENDING"]),
            ),
          )
          .groupBy(AppointmentTable.serviceId),
        db
          .select({ preferences: CompanySettingsTable.preferences })
          .from(CompanySettingsTable)
          .where(eq(CompanySettingsTable.companyId, companyId))
          .limit(1),
        db.select({
          id: SubscriptionPlanTable.id,
          name: SubscriptionPlanTable.name,
          allowedDaysOfWeek: SubscriptionPlanTable.allowedDaysOfWeek,
        }).from(SubscriptionPlanTable)
          .where(eq(SubscriptionPlanTable.companyId, companyId))
          .orderBy(asc(SubscriptionPlanTable.name)),
      ]);

    const serviceIdsByCollaborator = new Map<string, string[]>();
    for (const link of linksRows) {
      const list = serviceIdsByCollaborator.get(link.collaboratorId) ?? [];
      list.push(link.serviceId);
      serviceIdsByCollaborator.set(link.collaboratorId, list);
    }

    const bookingCountByServiceId = new Map<string, number>();
    for (const row of popularityRows) {
      if (row.serviceId) {
        bookingCountByServiceId.set(row.serviceId, Number(row.totalBookings ?? 0));
      }
    }

    const services: AiBookingServiceSummary[] = servicesRows
      .map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        category: inferServiceCategory({
          name: s.name,
          description: s.description,
        }),
        durationMinutes: s.durationMinutes,
        priceInCents: s.priceInCents,
      }))
      .sort((a, b) => {
        const countDiff =
          (bookingCountByServiceId.get(b.id) ?? 0) -
          (bookingCountByServiceId.get(a.id) ?? 0);
        if (countDiff !== 0) return countDiff;
        return a.name.localeCompare(b.name, "pt-BR");
      });

    const packageSales = settingsRows[0]?.preferences?.packageSales ?? null;
    const planServices = services.filter((s) => isSubscriptionPlanService(s));
    const subscriptionPlans: AiBookingSubscriptionPlansResult = {
      enabled: Boolean(packageSales?.enabled) || clubPlans.length > 0 || planServices.length > 0,
      notes: packageSales?.enabled
        ? packageSales.notes?.trim() || null
        : null,
      plans: clubPlans.length > 0 ? clubPlans : planServices.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        priceInCents: s.priceInCents,
        durationMinutes: s.durationMinutes,
      })),
    };

    return {
      services,
      servicesByCategory: groupServicesByCategory(services),
      collaborators: collaboratorsRows.map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty || null,
        serviceIds: serviceIdsByCollaborator.get(c.id) ?? [],
      })),
      subscriptionPlans,
    };
  }

  // Carrega somente regras operacionais públicas da loja (endereço, Maps, pagamento, atraso e pacotes),
  // nunca expondo métricas financeiras internas ou comissões.
  private async loadOperationalRules(
    companyId: string,
  ): Promise<AiBookingOperationalRules> {
    const [settingsRow] = await db
      .select({ preferences: CompanySettingsTable.preferences })
      .from(CompanySettingsTable)
      .where(eq(CompanySettingsTable.companyId, companyId))
      .limit(1);

    const prefs = settingsRow?.preferences;
    if (!prefs) {
      return {};
    }

    let formattedAddress: string | null = null;
    if (prefs.address) {
      if ("street" in prefs.address) {
        const parts = [
          [prefs.address.street, prefs.address.number].filter(Boolean).join(", "),
          prefs.address.district,
          [prefs.address.city, prefs.address.state].filter(Boolean).join(" - "),
          prefs.address.postalCode,
        ].filter((part) => Boolean(part && part.trim()));
        formattedAddress = parts.length > 0 ? parts.join(" · ") : null;
      } else {
        const parts = [
          prefs.address.addressLine,
          prefs.address.sector,
          [prefs.address.city, prefs.address.state].filter(Boolean).join(" - "),
          prefs.address.referencePoint
            ? `Ref: ${prefs.address.referencePoint}`
            : "",
        ].filter((part) => Boolean(part && part.trim()));
        formattedAddress = parts.length > 0 ? parts.join(" · ") : null;
      }
    }

    const paymentParts: string[] = [];
    if (prefs.onlinePayment?.enabled) {
      paymentParts.push(
        `Pagamento online/PIX ativo (${prefs.onlinePayment.pixKeyType}${prefs.onlinePayment.depositPercentage > 0 ? `, sinal de ${prefs.onlinePayment.depositPercentage}%` : ""})`,
      );
    }

    const delayParts: string[] = [];
    if (prefs.onlinePayment?.noShowPolicy?.trim()) {
      delayParts.push(prefs.onlinePayment.noShowPolicy.trim());
    }
    if (typeof prefs.cancelLeadTime === "number" && prefs.cancelLeadTime > 0) {
      delayParts.push(
        `Cancelamento permitido com antecedência mínima de ${prefs.cancelLeadTime} minutos.`,
      );
    }

    const packageNotes = prefs.packageSales?.enabled
      ? prefs.packageSales.notes?.trim() || "Venda de pacotes/assinaturas disponível na loja."
      : null;

    return {
      address: formattedAddress,
      googleMapsUrl: prefs.googleMapsUrl ?? null,
      paymentMethods: paymentParts.length > 0 ? paymentParts.join(" | ") : null,
      delayPolicy: delayParts.length > 0 ? delayParts.join(" ") : null,
      packageNotes,
    };
  }

  // Carrega o perfil operacional e histórico do cliente (sem valores gastos ou dados financeiros internos),
  // Isola o histórico por companyId e pelo telefone completo do remetente.
  private async loadCustomerContext(params: {
    companyId: string;
    pushName?: string | null | undefined;
    customerPhone: string;
    timezone: string;
    now: Date;
  }): Promise<AiBookingCustomerContext> {
    const phone = normalizeCustomerPhone(params.customerPhone);
    if (!phone) {
      return {
        isNewCustomer: true,
        totalVisits: 0,
        registeredName: sanitizeCustomerName(params.pushName),
      };
    }

    const phoneMatcher = eq(
      sql`regexp_replace(${AppointmentTable.clientPhone}, '[^0-9]', '', 'g')`,
      phone,
    );
    const clientPhoneMatcher = eq(
      sql`regexp_replace(${ClientTable.phone}, '[^0-9]', '', 'g')`,
      phone,
    );
    const conversationPhoneMatcher = eq(
      sql`regexp_replace(${WhatsAppConversationsTable.phone}, '[^0-9]', '', 'g')`,
      phone,
    );

    const [clientRows, conversationRows, historyRows, upcomingResult] =
      await Promise.all([
        db
          .select({
            id: ClientTable.id,
            name: ClientTable.name,
            tags: ClientTable.tags,
          })
          .from(ClientTable)
          .where(
            and(eq(ClientTable.companyId, params.companyId), clientPhoneMatcher),
          )
          .limit(10),
        db
          .select({
            contactName: WhatsAppConversationsTable.contactName,
          })
          .from(WhatsAppConversationsTable)
          .where(
            and(
              eq(WhatsAppConversationsTable.companyId, params.companyId),
              conversationPhoneMatcher,
            ),
          )
          .limit(5),
        db
          .select({
            serviceName: AppointmentTable.serviceNameSnapshot,
            collaboratorName: CollaboratorTable.name,
            startsAt: AppointmentTable.startsAt,
            status: AppointmentTable.status,
          })
          .from(AppointmentTable)
          .innerJoin(
            CollaboratorTable,
            and(
              eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
              eq(AppointmentTable.companyId, CollaboratorTable.companyId),
            ),
          )
          .where(
            and(
              eq(AppointmentTable.companyId, params.companyId),
              inArray(AppointmentTable.status, ["COMPLETED", "CONFIRMED", "PENDING"]),
              phoneMatcher,
            ),
          )
          .orderBy(desc(AppointmentTable.startsAt))
          .limit(30),
        this.listCustomerUpcomingAppointments({
          companyId: params.companyId,
          customerPhone: params.customerPhone,
          timezone: params.timezone,
          // Retrocede 2h para incluir agendamentos de hoje em caso de atraso do cliente.
          now: new Date(params.now.getTime() - 2 * 60 * 60 * 1000),
        }),
      ]);

    const validClientName =
      clientRows
        .map((row) => sanitizeCustomerName(row.name))
        .find((name): name is string => Boolean(name)) ??
      null;
    const realWhatsAppName =
      sanitizeCustomerName(params.pushName) ??
      conversationRows
        .map((row) => sanitizeCustomerName(row.contactName))
        .find((name): name is string => Boolean(name)) ??
      null;
    const effectiveName = validClientName ?? realWhatsAppName ?? null;

    // Atualiza automaticamente registros de `clients` com nome placeholder (ex.: "Cliente Teste", "Cliente")
    // assim que um nome real do WhatsApp estiver disponível, evitando recorrência do bug.
    const placeholderClientIds = clientRows
      .filter((row) => !sanitizeCustomerName(row.name))
      .map((row) => row.id);
    if (placeholderClientIds.length > 0 && (realWhatsAppName ?? validClientName)) {
      const replacementName = (realWhatsAppName ?? validClientName)!;
      try {
        await db
          .update(ClientTable)
          .set({ name: replacementName, updatedAt: new Date() })
          .where(
            and(
              eq(ClientTable.companyId, params.companyId),
              clientPhoneMatcher,
              inArray(ClientTable.id, placeholderClientIds),
            ),
          );
      } catch {
        // Correção oportunista de placeholder não deve impedir a resposta ao cliente.
      }
    }

    const historySummary = summarizeCustomerVisitHistory(
      historyRows,
      params.timezone,
    );

    const todayLocalDate = getLocalDateTimeParts(
      params.now,
      params.timezone,
    ).dateString;
    const todayAppointments = upcomingResult.appointments.filter(
      (appt) => appt.localDate === todayLocalDate,
    );

    const tagSet = new Set<string>();
    for (const row of clientRows) {
      for (const tag of row.tags ?? []) {
        const cleaned = tag.trim();
        if (cleaned.length > 0 && cleaned.toLowerCase() !== "whatsapp") {
          tagSet.add(cleaned);
        }
      }
    }
    const activePackagesOrTags = Array.from(tagSet);

    return {
      isNewCustomer: historySummary.isNewCustomer,
      totalVisits: historySummary.totalVisits,
      registeredName: effectiveName,
      mostFrequentServiceName: historySummary.mostFrequentServiceName,
      lastCompletedVisit: historySummary.lastCompletedVisit,
      preferredCollaboratorName: historySummary.preferredCollaboratorName,
      habitualWeekday: historySummary.habitualWeekday,
      activePackagesOrTags,
      todayAppointments,
    };
  }

  // Busca agendamentos futuros ativos (PENDING/CONFIRMED) do cliente na empresa, normalizando os dígitos do telefone.
  async listCustomerUpcomingAppointments(input: {
    companyId: string;
    customerPhone: string;
    now?: Date | undefined;
    timezone?: string | undefined;
  }): Promise<{ appointments: AiBookingCustomerAppointment[] }> {
    const phone = normalizeCustomerPhone(input.customerPhone);
    if (!phone) {
      return { appointments: [] };
    }

    let timezone = input.timezone;
    if (!timezone) {
      const [companyRow] = await db
        .select({ timezone: CompanyTable.timezone })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, input.companyId))
        .limit(1);
      if (!companyRow) {
        return { appointments: [] };
      }
      timezone = companyRow.timezone;
    }

    const referenceNow = input.now ?? new Date();
    const rows = await db
      .select({
        appointmentId: AppointmentTable.id,
        serviceName: AppointmentTable.serviceNameSnapshot,
        collaboratorName: CollaboratorTable.name,
        startsAt: AppointmentTable.startsAt,
        status: AppointmentTable.status,
      })
      .from(AppointmentTable)
      .innerJoin(
        CollaboratorTable,
        and(
          eq(AppointmentTable.collaboratorId, CollaboratorTable.id),
          eq(AppointmentTable.companyId, CollaboratorTable.companyId),
        ),
      )
      .where(
        and(
          eq(AppointmentTable.companyId, input.companyId),
          inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
          gte(AppointmentTable.startsAt, referenceNow),
          eq(
            sql`regexp_replace(${AppointmentTable.clientPhone}, '[^0-9]', '', 'g')`,
            phone,
          ),
        ),
      )
      .orderBy(asc(AppointmentTable.startsAt));

    return {
      appointments: rows.map((row) => {
        const parts = getLocalDateTimeParts(row.startsAt, timezone);
        const hh = String(parts.hour).padStart(2, "0");
        const mm = String(parts.minute).padStart(2, "0");
        return {
          appointmentId: row.appointmentId,
          serviceName: row.serviceName,
          collaboratorName: row.collaboratorName,
          localDate: parts.dateString,
          localTime: `${hh}:${mm}`,
          startsAt: row.startsAt.toISOString(),
          status: row.status,
        };
      }),
    };
  }

  async buildContextAndTools({
    companyId,
    aiSystemPrompt,
    clientName,
    clientPhone,
  }: Parameters<AiBookingContextProviderPort["buildContextAndTools"]>[0]): Promise<{
    company: AiBookingCompanyContext;
    tools: AiBookingToolExecutor;
  } | null> {
    const [companyRow] = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        timezone: CompanyTable.timezone,
        isActive: CompanyTable.isActive,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    if (!companyRow || !companyRow.isActive) {
      return null;
    }

    const now = new Date();
    const [catalog, operationalRules, customerContext] = await Promise.all([
      this.loadCatalog(companyId),
      this.loadOperationalRules(companyId),
      this.loadCustomerContext({
        companyId,
        pushName: clientName,
        customerPhone: clientPhone,
        timezone: companyRow.timezone,
        now,
      }),
    ]);

    const customerPhone = normalizeCustomerPhone(clientPhone);
    const requireCustomerAppointment = async (appointmentId: string) => {
      const appointment = await this.appointmentsRepository.findById(companyId, appointmentId);
      if (!customerPhone || !appointment || normalizeCustomerPhone(appointment.clientPhone) !== customerPhone) {
        throw new Error("Agendamento não encontrado para este número de WhatsApp.");
      }
    };

    const aiActor: ActorContext = {
      userId: companyId,
      companyId,
      role: "OWNER",
    };

    const formatLocalSlot = (isoOrDate: string | Date) => {
      const dateObj = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
      const parts = getLocalDateTimeParts(dateObj, companyRow.timezone);
      const hh = String(parts.hour).padStart(2, "0");
      const mm = String(parts.minute).padStart(2, "0");
      return {
        localDate: parts.dateString,
        localTime: `${hh}:${mm}`,
      };
    };

    // Interpreta startsAt com segurança: se vier sem Z/offset (horário local ingênuo),
    // converte usando o fuso horário real da empresa em vez do fuso do servidor Node.
    const parseStartsAtInCompanyTimezone = (rawStartsAt: string): Date => {
      const trimmed = rawStartsAt.trim();
      const naiveMatch =
        /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
      if (naiveMatch) {
        return localDateTimeToUtc(
          Number(naiveMatch[1]),
          Number(naiveMatch[2]),
          Number(naiveMatch[3]),
          Number(naiveMatch[4]),
          Number(naiveMatch[5]),
          companyRow.timezone,
        );
      }
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Data/hora inválida em startsAt: "${rawStartsAt}".`);
      }
      return parsed;
    };

    // Resolve o nome real do cliente estritamente na ordem: clients -> pushName -> null.
    const resolvedCustomerName = resolveCustomerDisplayName({
      clientName: customerContext.registeredName,
      pushName: clientName,
    });
    const normalizedCustomerContext: AiBookingCustomerContext = {
      ...customerContext,
      registeredName: resolvedCustomerName,
    };

    const tools: AiBookingToolExecutor = {
      listServicesAndProfessionals: async () => this.loadCatalog(companyId),

      listSubscriptionPlans: async () => {
        const freshCatalog = await this.loadCatalog(companyId);
        return freshCatalog.subscriptionPlans;
      },

      checkAvailability: async ({ serviceId, date, collaboratorId }) => {
        const normalizedCollaboratorId = collaboratorId?.trim() || undefined;
        const result = await this.getAvailabilityUseCase.execute({
          companyId,
          serviceId,
          date,
          collaboratorId: normalizedCollaboratorId,
          timezone: companyRow.timezone,
          actorSource: "WHATSAPP_AI",
        });

        return {
          date: result.date,
          timezone: result.timezone,
          serviceDurationMinutes: result.serviceDurationMinutes,
          slots: result.slots.map((slot) => ({
            ...slot,
            ...formatLocalSlot(slot.startsAt),
          })),
        };
      },

      // Sempre vincula a busca ao telefone autenticado da conversa atual para evitar acesso a dados de terceiros.
      listCustomerUpcomingAppointments: async () =>
        this.listCustomerUpcomingAppointments({
          companyId,
          customerPhone: clientPhone,
          timezone: companyRow.timezone,
        }),

      createAppointment: async ({
        serviceId,
        collaboratorId,
        startsAt,
        localDate,
        localTime,
        clientName,
        notes,
        isGuest,
        payFullPrice,
      }) => {
        const normalizedCollaboratorId = collaboratorId.trim();
        const parsedStartsAt = parseStartsAtInCompanyTimezone(startsAt);
        const actualLocal = formatLocalSlot(parsedStartsAt);

        // Trava de segurança contra desfase de fuso: impede salvar horário UTC que não corresponde
        // à data/hora local informada pelo cliente (ex.: confundir 14:00Z com 14:00 local).
        const normalizedExpectedDate = localDate?.trim();
        const normalizedExpectedTime = localTime?.trim().slice(0, 5);
        if (
          (normalizedExpectedDate && normalizedExpectedDate !== actualLocal.localDate) ||
          (normalizedExpectedTime && normalizedExpectedTime !== actualLocal.localTime)
        ) {
          throw new Error(
            `Divergência de fuso horário: startsAt "${startsAt}" corresponde a ${actualLocal.localDate} às ${actualLocal.localTime} (${companyRow.timezone}), mas o horário solicitado foi ${normalizedExpectedDate ?? actualLocal.localDate} às ${normalizedExpectedTime ?? actualLocal.localTime}. Consulte consultar_horarios_livres e use o startsAt exato do slot correspondente.`,
          );
        }

        // O caso de uso valida o expediente e o repositório verifica o slot dentro da transação.
        const loadAvailableSlots = async () => {
          const availability = await this.getAvailabilityUseCase.execute({
            companyId,
            serviceId,
            date: actualLocal.localDate,
            collaboratorId: normalizedCollaboratorId,
            timezone: companyRow.timezone,
            actorSource: "WHATSAPP_AI",
          });
          return availability.slots.map((slot) => ({
            ...slot,
            ...formatLocalSlot(slot.startsAt),
          }));
        };

        try {
          const created = await this.createAppointmentUseCase.executeInternal({
            actor: aiActor,
            actorSource: "WHATSAPP_AI",
            serviceId,
            collaboratorId: normalizedCollaboratorId,
            startsAt: parsedStartsAt,
            clientName:
              sanitizeCustomerName(clientName) ??
              resolvedCustomerName ??
              `Cliente ${clientPhone.replace(/\D/g, "").slice(-4) || "WhatsApp"}`,
            clientPhone,
            isGuest,
            payFullPrice,
            notes: notes?.trim() || "Agendado via WhatsApp IA",
            initialStatus: "CONFIRMED",
          });

          return {
            success: true,
            id: created.id,
            startsAt: created.startsAt,
            endsAt: created.endsAt,
            ...formatLocalSlot(created.startsAt),
            servicePriceInCents: created.servicePriceInCentsSnapshot,
            status: created.status,
            serviceName: created.serviceNameSnapshot,
            collaboratorId: created.collaboratorId,
          };
        } catch (error) {
          if (error instanceof AppointmentPolicyError) return {
            success: false,
            code: error.reasonCode,
            error: error.message,
            currentAppointment: error.currentAppointment,
            availableSlots: [],
          };
          // Proteção extra para concorrência (race condition entre a consulta prévia e o lock transacional).
          if (error instanceof AppointmentTimeConflictError) {
            const refreshedSlots = await loadAvailableSlots();
            return {
              success: false,
              error: "Horário já ocupado na agenda",
              availableSlots: refreshedSlots,
            };
          }
          throw error;
        }
      },

      rescheduleAppointment: async ({
        appointmentId,
        startsAt,
        collaboratorId,
        payFullPrice,
      }) => {
        await requireCustomerAppointment(appointmentId);
        const updated = await this.rescheduleAppointmentUseCase.execute({
          actor: aiActor,
          actorSource: "WHATSAPP_AI",
          appointmentId,
          startsAt: parseStartsAtInCompanyTimezone(startsAt),
          collaboratorId,
          payFullPrice,
        });

        return {
          id: updated.id,
          servicePriceInCents: updated.servicePriceInCentsSnapshot,
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          ...formatLocalSlot(updated.startsAt),
          status: updated.status,
          collaboratorId: updated.collaboratorId,
        };
      },

      cancelAppointment: async ({ appointmentId, cancellationReason }) => {
        await requireCustomerAppointment(appointmentId);
        const updated = await this.updateAppointmentStatusUseCase.execute({
          actor: aiActor,
          actorSource: "WHATSAPP_AI",
          appointmentId,
          status: "CANCELED",
          cancellationReason:
            cancellationReason?.trim() || "Cancelado pelo cliente via WhatsApp IA",
        });

        return {
          id: updated.id,
          status: updated.status,
        };
      },

      requestHumanHandoff: async ({ reason }) => ({
        handoff: true as const,
        reason: reason?.trim() || "Cliente solicitou atendimento humano.",
      }),
    };

    return {
      company: {
        companyId: companyRow.id,
        companyName: companyRow.companyName,
        timezone: companyRow.timezone,
        aiSystemPrompt,
        services: catalog.services,
        collaborators: catalog.collaborators,
        operationalRules,
        customerContext: normalizedCustomerContext,
      },
      tools,
    };
  }
}
