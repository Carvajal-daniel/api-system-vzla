import {
  AppointmentNotFoundError,
  AppointmentNotReschedulableError,
  CollaboratorNotEnabledForServiceError,
  SchedulingCompanyNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../domain/repositories/scheduling-context-lookup.repository.js";
import { AvailabilityCalculator } from "../../domain/services/availability-calculator.js";
import { getLocalDateTimeParts } from "../../domain/services/timezone-utils.js";
import { AppointmentStatus } from "../../domain/value-objects/appointment-status.vo.js";
import {
  type AppointmentOutputDTO,
  type RescheduleAppointmentInputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export class RescheduleAppointmentUseCase {
  constructor(
    private readonly lookupRepository: SchedulingContextLookupRepository,
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async execute(
    input: RescheduleAppointmentInputDTO,
  ): Promise<AppointmentOutputDTO> {
    const { actor } = input;

    if (actor.role !== "OWNER") {
      throw new UnauthorizedSchedulingActionError();
    }

    const appointment = await this.appointmentsRepository.findById(
      actor.companyId,
      input.appointmentId,
    );

    if (!appointment) {
      throw new AppointmentNotFoundError();
    }

    if (!AppointmentStatus.create(appointment.status).isReschedulable()) {
      throw new AppointmentNotReschedulableError(appointment.status);
    }

    const company = await this.lookupRepository.findCompanyById(actor.companyId);
    if (!company || !company.isActive) {
      throw new SchedulingCompanyNotFoundError();
    }

    const targetCollaboratorId = input.collaboratorId ?? appointment.collaboratorId;
    const enabledCollaborator =
      await this.lookupRepository.findEnabledCollaboratorForService(
        actor.companyId,
        appointment.serviceId,
        targetCollaboratorId,
      );

    if (!enabledCollaborator || !enabledCollaborator.isActive) {
      throw new CollaboratorNotEnabledForServiceError();
    }

    // Preserva a duração histórica congelada no snapshot do agendamento ao calcular o novo intervalo.
    const durationMinutes = appointment.serviceDurationMinutesSnapshot;
    const derivedEndsAt = new Date(
      input.startsAt.getTime() + durationMinutes * 60_000,
    );
    const localStart = getLocalDateTimeParts(input.startsAt, company.timezone);

    const [workSchedule, blocks] = await Promise.all([
      this.lookupRepository.findWorkScheduleForDay(
        actor.companyId,
        targetCollaboratorId,
        localStart.dayOfWeek,
      ),
      this.scheduleBlocksRepository.findOverlappingForCollaborator(
        actor.companyId,
        targetCollaboratorId,
        input.startsAt,
        derivedEndsAt,
      ),
    ]);

    AvailabilityCalculator.validateSlotAvailability({
      startsAt: input.startsAt,
      serviceDurationMinutes: durationMinutes,
      timezone: company.timezone,
      now: input.now ?? new Date(),
      workSchedule,
      blocks: blocks.map((b) => b.toTimeRange()),
    });

    appointment.reschedule(input.startsAt, targetCollaboratorId);
    await this.appointmentsRepository.rescheduleWithLock(appointment);

    return toAppointmentOutputDTO(appointment);
  }
}
