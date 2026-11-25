import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { db } from "../../../../shared/database/database.js";
import { CreateAppointmentUseCase } from "../../../appointments/application/use-cases/create-appointment.use-case.js";
import { GetAvailabilityUseCase } from "../../../appointments/application/use-cases/get-availability.use-case.js";
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
import { CollaboratorTable } from "../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorServiceTable } from "../../../services/infra/database/schema/collaborator-services-schema.js";
import { ServiceTable } from "../../../services/infra/database/schema/services-schema.js";
import type {
  AiBookingCollaboratorSummary,
  AiBookingCompanyContext,
  AiBookingCustomerAppointment,
  AiBookingServiceSummary,
  AiBookingToolExecutor,
} from "../../application/ports/ai-booking-agent.port.js";
import type { AiBookingContextProviderPort } from "../../application/ports/ai-booking-context-provider.port.js";

// Normaliza dígitos do telefone e gera variantes com/sem DDI 55 para casar com client_phone e clients.phone.
function buildNormalizedPhoneDigitVariants(rawPhone: string): string[] {
  const digits = rawPhone.replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set<string>([digits]);
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    variants.add(digits.slice(2));
  } else if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    variants.add(`55${digits}`);
  }
  return Array.from(variants);
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
    collaborators: AiBookingCollaboratorSummary[];
  }> {
    const [servicesRows, collaboratorsRows, linksRows] = await Promise.all([
      db
        .select({
          id: ServiceTable.id,
          name: ServiceTable.name,
          durationMinutes: ServiceTable.durationMinutes,
          priceInCents: ServiceTable.priceInCents,
        })
        .from(ServiceTable)
        .where(
          and(
            eq(ServiceTable.companyId, companyId),
            eq(ServiceTable.active, true),
          ),
        ),
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
    ]);

    const serviceIdsByCollaborator = new Map<string, string[]>();
    for (const link of linksRows) {
      const list = serviceIdsByCollaborator.get(link.collaboratorId) ?? [];
      list.push(link.serviceId);
      serviceIdsByCollaborator.set(link.collaboratorId, list);
    }

    return {
      services: servicesRows.map((s) => ({
        id: s.id,
        name: s.name,
        durationMinutes: s.durationMinutes,
        priceInCents: s.priceInCents,
      })),
      collaborators: collaboratorsRows.map((c) => ({
        id: c.id,
        name: c.name,
        specialty: c.specialty || null,
        serviceIds: serviceIdsByCollaborator.get(c.id) ?? [],
      })),
    };
  }

  // Busca agendamentos futuros ativos (PENDING/CONFIRMED) do cliente na empresa, normalizando os dígitos do telefone.
  async listCustomerUpcomingAppointments(input: {
    companyId: string;
    customerPhone: string;
    now?: Date | undefined;
    timezone?: string | undefined;
  }): Promise<{ appointments: AiBookingCustomerAppointment[] }> {
    const phoneVariants = buildNormalizedPhoneDigitVariants(input.customerPhone);
    if (phoneVariants.length === 0) {
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
          inArray(
            sql`regexp_replace(${AppointmentTable.clientPhone}, '\\D', '', 'g')`,
            phoneVariants,
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

  async buildContextAndTools(input: {
    companyId: string;
    aiSystemPrompt: string | null;
    clientName: string;
    clientPhone: string;
  }): Promise<{
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
      .where(eq(CompanyTable.id, input.companyId))
      .limit(1);

    if (!companyRow || !companyRow.isActive) {
      return null;
    }

    const catalog = await this.loadCatalog(input.companyId);

    const aiActor: ActorContext = {
      userId: input.companyId,
      companyId: input.companyId,
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

    const tools: AiBookingToolExecutor = {
      listServicesAndProfessionals: async () => this.loadCatalog(input.companyId),

      checkAvailability: async ({ serviceId, date, collaboratorId }) => {
        const normalizedCollaboratorId = collaboratorId?.trim() || undefined;
        const result = await this.getAvailabilityUseCase.execute({
          companyId: input.companyId,
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
          companyId: input.companyId,
          customerPhone: input.clientPhone,
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

        // Trava obrigatória de disponibilidade: valida contra GetAvailabilityUseCase se o slot exato
        // (profissional + serviço + data/hora local) está realmente livre antes de tentar gravar no banco.
        const loadAvailableSlots = async () => {
          const availability = await this.getAvailabilityUseCase.execute({
            companyId: input.companyId,
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

        const availableSlots = await loadAvailableSlots();
        const requestedStartsAtMs = parsedStartsAt.getTime();
        const isSlotFree = availableSlots.some(
          (slot) =>
            slot.collaboratorId === normalizedCollaboratorId &&
            new Date(slot.startsAt).getTime() === requestedStartsAtMs &&
            slot.localDate === actualLocal.localDate &&
            slot.localTime === actualLocal.localTime,
        );

        if (!isSlotFree) {
          return {
            success: false,
            error: "Horário já ocupado na agenda",
            availableSlots,
          };
        }

        try {
          const created = await this.createAppointmentUseCase.executeInternal({
            actor: aiActor,
            actorSource: "WHATSAPP_AI",
            serviceId,
            collaboratorId: normalizedCollaboratorId,
            startsAt: parsedStartsAt,
            clientName: clientName?.trim() || input.clientName,
            clientPhone: input.clientPhone,
            notes: notes?.trim() || "Agendado via WhatsApp IA",
            initialStatus: "CONFIRMED",
          });

          return {
            success: true,
            id: created.id,
            startsAt: created.startsAt,
            endsAt: created.endsAt,
            ...formatLocalSlot(created.startsAt),
            status: created.status,
            serviceName: created.serviceNameSnapshot,
            collaboratorId: created.collaboratorId,
          };
        } catch (error) {
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
      }) => {
        const updated = await this.rescheduleAppointmentUseCase.execute({
          actor: aiActor,
          actorSource: "WHATSAPP_AI",
          appointmentId,
          startsAt: parseStartsAtInCompanyTimezone(startsAt),
          collaboratorId,
        });

        return {
          id: updated.id,
          startsAt: updated.startsAt,
          endsAt: updated.endsAt,
          ...formatLocalSlot(updated.startsAt),
          status: updated.status,
          collaboratorId: updated.collaboratorId,
        };
      },

      cancelAppointment: async ({ appointmentId, cancellationReason }) => {
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
    };

    return {
      company: {
        companyId: companyRow.id,
        companyName: companyRow.companyName,
        timezone: companyRow.timezone,
        aiSystemPrompt: input.aiSystemPrompt,
        services: catalog.services,
        collaborators: catalog.collaborators,
      },
      tools,
    };
  }
}
