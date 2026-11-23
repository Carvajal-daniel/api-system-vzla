import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  AppointmentNotFoundError,
  AppointmentRevertNotAllowedError,
  InvalidOwnerAuthorizationError,
  RevertReasonRequiredError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../domain/repositories/appointments.repository.js";
import {
  type AppointmentAuditLogOutputDTO,
  type AppointmentOutputDTO,
  toAppointmentAuditLogOutputDTO,
  toAppointmentOutputDTO,
} from "../dtos/appointment.dtos.js";

export interface OwnerAuthorizationVerifier {
  verifyOwnerPassword(
    companyId: string,
    plainPassword: string,
  ): Promise<{ id: string; name: string } | null>;
}

export interface RevertCompletedAppointmentInputDTO {
  actor: ActorContext;
  appointmentId: string;
  reason: string;
  ownerPassword: string;
}

export interface RevertCompletedAppointmentOutputDTO {
  appointment: AppointmentOutputDTO;
  auditLog: AppointmentAuditLogOutputDTO;
}

export class RevertCompletedAppointmentUseCase {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
    private readonly ownerAuthorizationVerifier: OwnerAuthorizationVerifier,
  ) {}

  async execute(
    input: RevertCompletedAppointmentInputDTO,
  ): Promise<RevertCompletedAppointmentOutputDTO> {
    const { actor } = input;

    // Apenas o perfil OWNER pode autorizar a reversão de um atendimento concluído.
    if (actor.role !== "OWNER") {
      throw new UnauthorizedSchedulingActionError();
    }

    const reason = input.reason.trim();
    if (reason.length < 5) {
      throw new RevertReasonRequiredError();
    }

    const authorizedOwner = await this.ownerAuthorizationVerifier.verifyOwnerPassword(
      actor.companyId,
      input.ownerPassword,
    );
    if (!authorizedOwner) {
      throw new InvalidOwnerAuthorizationError();
    }

    const appointment = await this.appointmentsRepository.findById(
      actor.companyId,
      input.appointmentId,
    );
    if (!appointment) {
      throw new AppointmentNotFoundError();
    }

    if (appointment.status !== "COMPLETED") {
      throw new AppointmentRevertNotAllowedError();
    }

    const expected = {
      startsAt: appointment.startsAt,
      status: appointment.status,
      collaboratorId: appointment.collaboratorId,
    };

    appointment.revertCompletion();

    const auditRecord = await this.appointmentsRepository.revertCompletionWithAudit(
      appointment,
      expected,
      {
        action: "REVERT_COMPLETION",
        previousStatus: "COMPLETED",
        newStatus: appointment.status,
        reason,
        authorizedById: authorizedOwner.id,
        authorizedByName: authorizedOwner.name,
        authorizedByRole: actor.role,
      },
    );

    return {
      appointment: toAppointmentOutputDTO(appointment),
      auditLog: toAppointmentAuditLogOutputDTO(auditRecord),
    };
  }
}
