import {
  CollaboratorNotEnabledForServiceError,
  SchedulingCompanyNotFoundError,
  SchedulingServiceNotFoundError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type {
  EnabledCollaboratorForServiceContext,
  SchedulingContextLookupRepository,
} from "../../domain/repositories/scheduling-context-lookup.repository.js";
import {
  AvailabilityCalculator,
  DEFAULT_SLOT_STEP_MINUTES,
} from "../../domain/services/availability-calculator.js";
import {
  assertValidIanaTimeZone,
  getLocalDayUtcBounds,
} from "../../domain/services/timezone-utils.js";
import type {
  AvailabilitySlotOutputDTO,
  GetAvailabilityInputDTO,
  GetAvailabilityOutputDTO,
} from "../dtos/availability.dtos.js";

export class GetAvailabilityUseCase {
  constructor(
    private readonly lookupRepository: SchedulingContextLookupRepository,
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async execute(
    input: GetAvailabilityInputDTO,
  ): Promise<GetAvailabilityOutputDTO> {
    const company = await this.lookupRepository.findCompanyById(input.companyId);
    if (!company || !company.isActive) {
      throw new SchedulingCompanyNotFoundError();
    }

    const timezone = assertValidIanaTimeZone(input.timezone ?? company.timezone);
    const { startUtc, endUtc, dayOfWeek } = getLocalDayUtcBounds(
      input.date,
      timezone,
    );

    // Verifica se a barbearia/salão atende neste dia da semana
    let companyOperatingHours: { openTime: string; closeTime: string } | null = null;
    if (company.operatingSchedule && Array.isArray(company.operatingSchedule)) {
      const scheduleSlot = company.operatingSchedule.find((s) => s.dayOfWeek === dayOfWeek);
      if (scheduleSlot) {
        if (!scheduleSlot.isOpen || !scheduleSlot.openTime || !scheduleSlot.closeTime) {
          return {
            companyId: input.companyId,
            serviceId: input.serviceId,
            date: input.date,
            timezone,
            slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES,
            serviceDurationMinutes: 0,
            slots: [],
          };
        }
        companyOperatingHours = {
          openTime: scheduleSlot.openTime,
          closeTime: scheduleSlot.closeTime,
        };
      }
    } else if (company.operatingDays) {
      const allowedDays = company.operatingDays.split(",").map((d) => Number(d.trim()));
      if (!allowedDays.includes(dayOfWeek)) {
        return {
          companyId: input.companyId,
          serviceId: input.serviceId,
          date: input.date,
          timezone,
          slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES,
          serviceDurationMinutes: 0,
          slots: [],
        };
      }
    }

    const service = await this.lookupRepository.findServiceById(
      input.companyId,
      input.serviceId,
    );
    if (!service || !service.active) {
      throw new SchedulingServiceNotFoundError();
    }

    let eligibleCollaborators: EnabledCollaboratorForServiceContext[];

    if (input.collaboratorId) {
      const collaborator =
        await this.lookupRepository.findEnabledCollaboratorForService(
          input.companyId,
          input.serviceId,
          input.collaboratorId,
        );

      if (!collaborator || !collaborator.isActive) {
        throw new CollaboratorNotEnabledForServiceError();
      }

      eligibleCollaborators = [collaborator];
    } else {
      eligibleCollaborators =
        await this.lookupRepository.listEnabledActiveCollaboratorsForService(
          input.companyId,
          input.serviceId,
        );
    }

    const now = input.now ?? new Date();
    const slots: AvailabilitySlotOutputDTO[] = [];

    for (const collaborator of eligibleCollaborators) {
      const [workSchedule, blocks, activeAppointments] = await Promise.all([
        this.lookupRepository.findWorkScheduleForDay(
          input.companyId,
          collaborator.collaboratorId,
          dayOfWeek,
        ),
        this.scheduleBlocksRepository.findOverlappingForCollaborator(
          input.companyId,
          collaborator.collaboratorId,
          startUtc,
          endUtc,
        ),
        this.appointmentsRepository.findActiveOverlapping(
          input.companyId,
          startUtc,
          endUtc,
          collaborator.collaboratorId,
        ),
      ]);

      const calculated = AvailabilityCalculator.calculateSlotsForCollaborator({
        date: input.date,
        timezone,
        serviceDurationMinutes: service.durationMinutes,
        slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES,
        now,
        collaborator: {
          id: collaborator.collaboratorId,
          name: collaborator.collaboratorName,
        },
        workSchedule,
        companyOperatingHours,
        blocks: blocks.map((b) => b.toTimeRange()),
        activeAppointments: activeAppointments.map((a) => a.toTimeRange()),
      });

      for (const slot of calculated) {
        slots.push({
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          collaboratorId: slot.collaboratorId,
          collaboratorName: slot.collaboratorName,
        });
      }
    }

    slots.sort((a, b) => {
      const timeDiff =
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.collaboratorName.localeCompare(b.collaboratorName);
    });

    return {
      companyId: input.companyId,
      serviceId: input.serviceId,
      date: input.date,
      timezone,
      slotStepMinutes: DEFAULT_SLOT_STEP_MINUTES,
      serviceDurationMinutes: service.durationMinutes,
      slots,
    };
  }
}
