import { Appointment } from "../../domain/entities/appointment.entity.js";
import {
  CollaboratorNotEnabledForServiceError,
  SchedulingCompanyNotFoundError,
  SchedulingServiceNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../domain/repositories/scheduling-context-lookup.repository.js";
import { AvailabilityCalculator } from "../../domain/services/availability-calculator.js";
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
      now: input.now ?? new Date(),
    });
  }

  async executeInternal(
    input: CreateInternalAppointmentInputDTO,
  ): Promise<AppointmentOutputDTO> {
    // Regra constitucional (Princípio III): colaborador tem proibição estrita de criar agendamentos por conta própria.
    if (input.actor.role !== "OWNER") {
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
    now: Date;
  }): Promise<AppointmentOutputDTO> {
    const company = await this.lookupRepository.findCompanyById(params.companyId);
    if (!company || !company.isActive) {
      throw new SchedulingCompanyNotFoundError();
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
      now: params.now,
      workSchedule,
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
      serviceNameSnapshot: service.name,
      servicePriceInCentsSnapshot: service.priceInCents,
      serviceDurationMinutesSnapshot: service.durationMinutes,
      commissionPercentageSnapshot: enabledCollaborator.commissionPercentage,
    });

    // Persistência atômica sob lock exclusivo por (companyId, collaboratorId) contra double-booking.
    await this.appointmentsRepository.createWithLock(appointment);

    return toAppointmentOutputDTO(appointment);
  }
}
