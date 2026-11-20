import { ScheduleBlock } from "../../domain/entities/schedule-block.entity.js";
import {
  SchedulingCollaboratorNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../domain/repositories/scheduling-context-lookup.repository.js";
import {
  type CreateScheduleBlockInputDTO,
  type CreateScheduleBlockOutputDTO,
  toAffectedAppointmentSummaryDTO,
  toScheduleBlockOutputDTO,
} from "../dtos/schedule-block.dtos.js";
import type { AbsenceNotificationPort } from "../ports/absence-notification.port.js";

export class CreateScheduleBlockUseCase {
  constructor(
    private readonly scheduleBlocksRepository: ScheduleBlocksRepository,
    private readonly appointmentsRepository: AppointmentsRepository,
    private readonly lookupRepository: SchedulingContextLookupRepository,
    private readonly absenceNotificationPort: AbsenceNotificationPort,
  ) {}

  async execute(
    input: CreateScheduleBlockInputDTO,
  ): Promise<CreateScheduleBlockOutputDTO> {
    const { actor } = input;
    let targetCollaboratorId: string | null;

    if (actor.role === "COLLABORATOR") {
      // Colaborador só pode criar bloqueios pessoais próprios; bloqueio global ou de terceiros é proibido.
      if (
        input.collaboratorId !== undefined &&
        input.collaboratorId !== actor.collaboratorId
      ) {
        throw new UnauthorizedSchedulingActionError();
      }
      targetCollaboratorId = actor.collaboratorId;
    } else {
      targetCollaboratorId = input.collaboratorId ?? null;

      if (targetCollaboratorId !== null) {
        const collaborator = await this.lookupRepository.findCollaboratorInCompany(
          actor.companyId,
          targetCollaboratorId,
        );
        if (!collaborator) {
          throw new SchedulingCollaboratorNotFoundError();
        }
      }
    }

    const block = ScheduleBlock.create({
      companyId: actor.companyId,
      collaboratorId: targetCollaboratorId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason ?? null,
    });

    await this.scheduleBlocksRepository.create(block);

    // Permite criar o bloqueio mesmo havendo citas ativas (emergências), mas identifica e reporta as impactadas.
    const overlappingActive =
      await this.appointmentsRepository.findActiveOverlapping(
        actor.companyId,
        block.startsAt,
        block.endsAt,
        block.collaboratorId,
      );

    const affectedAppointments = overlappingActive.map(
      toAffectedAppointmentSummaryDTO,
    );

    if (affectedAppointments.length > 0) {
      await this.absenceNotificationPort.notifyAffectedAppointments({
        companyId: actor.companyId,
        blockId: block.id,
        collaboratorId: block.collaboratorId,
        startsAt: block.startsAt.toISOString(),
        endsAt: block.endsAt.toISOString(),
        reason: block.reason,
        affectedAppointments,
      });
    }

    return {
      block: toScheduleBlockOutputDTO(block),
      affectedAppointments,
    };
  }
}
