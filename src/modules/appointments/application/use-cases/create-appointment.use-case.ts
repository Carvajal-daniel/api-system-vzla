import { Appointment } from "../../domain/entities/appointment.entity.js";
import {
  CollaboratorNotEnabledForServiceError,
  InvalidBookingClientDataError,
  SchedulingCompanyNotFoundError,
  SchedulingServiceNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository, PublicBookingDetails } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../domain/repositories/scheduling-context-lookup.repository.js";
import { AvailabilityCalculator, companySlotStep, getCompanyHours } from "../../domain/services/availability-calculator.js";
import { getLocalDateTimeParts } from "../../domain/services/timezone-utils.js";
import type { InitialAppointmentStatusValue } from "../../domain/value-objects/appointment-status.vo.js";
import {
  type AppointmentOutputDTO,
  type CreateInternalAppointmentInputDTO,
  type CreatePublicAppointmentInputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export class CreateAppointmentUseCase {
  constructor(
    private readonly lookupRepository: SchedulingContextLookupRepository,
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async executePublic(
    input: CreatePublicAppointmentInputDTO,
  ): Promise<AppointmentOutputDTO> {
    return this.createValidatedAppointment({
      companyId: input.companyId,
      serviceId: input.serviceId,
      collaboratorId: input.collaboratorId,
      startsAt: input.startsAt,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      initialStatus: "PENDING",
      publicBooking: true,
      publicDetails: input.publicDetails,
      now: input.now ?? new Date(),
    });
  }

  async executeInternal(
    input: CreateInternalAppointmentInputDTO,
  ): Promise<AppointmentOutputDTO> {
    // Regra constitucional (Princípio III): colaborador tem proibição estrita de criar agendamentos por conta própria.
    // Permite execução interna pelo OWNER ou por agente integrado de IA do WhatsApp.
    if (input.actor.role !== "OWNER" && input.actorSource !== "WHATSAPP_AI") {
      throw new UnauthorizedSchedulingActionError(
        "Collaborators are not permitted to create appointments.",
      );
    }

    return this.createValidatedAppointment({
      companyId: input.actor.companyId,
      serviceId: input.serviceId,
      collaboratorId: input.collaboratorId,
      startsAt: input.startsAt,
      clientName: input.clientName,
      clientPhone: input.clientPhone,
      notes: input.notes,
      initialStatus: input.initialStatus ?? "PENDING",
      now: input.now ?? new Date(),
    });
  }

  private async createValidatedAppointment(params: {
    companyId: string;
    serviceId: string;
    collaboratorId: string;
    startsAt: Date;
    clientName: string;
    clientPhone: string;
    initialStatus: InitialAppointmentStatusValue;
    notes?: string | undefined;
    publicBooking?: boolean;
    publicDetails?: PublicBookingDetails | undefined;
    now: Date;
  }): Promise<AppointmentOutputDTO> {
    const company = await this.lookupRepository.findCompanyById(params.companyId);
    if (!company || !company.isActive) {
      throw new SchedulingCompanyNotFoundError();
    }

    const details = params.publicDetails ? { ...params.publicDetails, clientData: { ...params.publicDetails.clientData } } : undefined;
    if (params.publicBooking && company.clientFields) {
      for (const [field, mode] of Object.entries(company.clientFields)) {
        if (mode === "required" && !details?.clientData[field]) throw new InvalidBookingClientDataError();
      }
      if (details) {
        for (const field of Object.keys(details.clientData)) {
          const selected = Object.hasOwn(company.clientFields, field) && company.clientFields[field] !== "hidden";
          if (!selected) delete details.clientData[field];
        }
      }
    }

    const service = await this.lookupRepository.findServiceById(
      params.companyId,
      params.serviceId,
    );
    if (!service || !service.active) {
      throw new SchedulingServiceNotFoundError();
    }

    const enabledCollaborator =
      await this.lookupRepository.findEnabledCollaboratorForService(
        params.companyId,
        params.serviceId,
        params.collaboratorId,
      );
    if (!enabledCollaborator || !enabledCollaborator.isActive) {
      throw new CollaboratorNotEnabledForServiceError();
    }

    // Deriva sempre endsAt a partir de startsAt + service.durationMinutes no backend.
    const derivedEndsAt = new Date(
      params.startsAt.getTime() + service.durationMinutes * 60_000,
    );
    const localStart = getLocalDateTimeParts(params.startsAt, company.timezone);

    const [workSchedule, blocks] = await Promise.all([
      this.lookupRepository.findWorkScheduleForDay(
        params.companyId,
        params.collaboratorId,
        localStart.dayOfWeek,
      ),
      this.scheduleBlocksRepository.findOverlappingForCollaborator(
        params.companyId,
        params.collaboratorId,
        params.startsAt,
        derivedEndsAt,
      ),
    ]);

    // Validação integral no domínio (futuro, expediente, descanso e bloqueios) sem assumir consulta prévia a /availability.
    AvailabilityCalculator.validateSlotAvailability({
      startsAt: params.startsAt,
      serviceDurationMinutes: service.durationMinutes,
      timezone: company.timezone,
      now: new Date(params.now.getTime() + (params.publicBooking ? company.leadTime ?? 0 : 0) * 60_000),
      step: companySlotStep(company, params.publicBooking),
      workSchedule,
      companyOperatingHours: getCompanyHours(company, localStart.dayOfWeek),
      blocks: blocks.map((b) => b.toTimeRange()),
    });

    const appointment = Appointment.create({
      companyId: params.companyId,
      collaboratorId: params.collaboratorId,
      serviceId: params.serviceId,
      clientName: params.clientName,
      clientPhone: params.clientPhone,
      startsAt: params.startsAt,
      initialStatus: params.initialStatus,
      notes: params.notes,
      serviceNameSnapshot: service.name,
      servicePriceInCentsSnapshot: service.priceInCents,
      serviceDurationMinutesSnapshot: service.durationMinutes,
      commissionPercentageSnapshot: enabledCollaborator.commissionPercentage,
    });

    // Persistência atômica sob lock exclusivo por (companyId, collaboratorId) contra double-booking.
    await this.appointmentsRepository.createWithLock(appointment, details);

    return toAppointmentOutputDTO(appointment);
  }
}
