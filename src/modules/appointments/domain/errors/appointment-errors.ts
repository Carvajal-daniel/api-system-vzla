import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class InvalidTimeRangeError extends DomainError {
  constructor(message = "End time must be strictly after start time.") {
    super(message, "VALIDATION");
  }
}

export class InvalidTimeZoneError extends DomainError {
  constructor(timezone?: string) {
    super(
      timezone
        ? `Invalid IANA timezone: "${timezone}".`
        : "Invalid IANA timezone.",
      "VALIDATION",
    );
  }
}

export class InvalidLocalDateError extends DomainError {
  constructor(message = "Date must be a valid calendar date in YYYY-MM-DD format.") {
    super(message, "VALIDATION");
  }
}

export class InvalidBookingClientDataError extends DomainError {
  constructor() {
    super("Preencha todos os dados obrigatórios.", "VALIDATION");
  }
}

export class InvalidClientNameError extends DomainError {
  constructor(message = "Client name must contain at least 2 characters.") {
    super(message, "VALIDATION");
  }
}

export class InvalidAppointmentStatusError extends DomainError {
  constructor(message = "Invalid appointment status.") {
    super(message, "VALIDATION");
  }
}

export class InvalidAppointmentStatusTransitionError extends DomainError {
  constructor(fromStatus: string, toStatus: string) {
    super(
      `Cannot transition appointment status from ${fromStatus} to ${toStatus}.`,
      "CONFLICT",
    );
  }
}

export class AppointmentCompletionTooEarlyError extends DomainError {
  constructor() {
    super("Cannot complete an appointment before it ends.", "VALIDATION");
  }
}

export class AppointmentSlotAlignmentError extends DomainError {
  constructor(step = 30) {
    super(`Appointment must start on a ${step}-minute boundary.`, "VALIDATION");
  }
}

export class AppointmentChangedError extends DomainError {
  constructor() {
    super("The appointment changed. Refresh and try again.", "CONFLICT");
  }
}

export class AppointmentInPastError extends DomainError {
  constructor(message = "Appointment start time must be in the future.") {
    super(message, "VALIDATION");
  }
}

export class AppointmentOutsideWorkScheduleError extends DomainError {
  constructor(
    message = "Requested time falls outside the collaborator's active working hours.",
  ) {
    super(message, "VALIDATION");
  }
}

export class AppointmentDuringBreakError extends DomainError {
  constructor(
    message = "Requested time overlaps with the collaborator's scheduled break.",
  ) {
    super(message, "VALIDATION");
  }
}

export class AppointmentBlockedError extends DomainError {
  constructor(
    message = "Requested time overlaps with an active schedule block.",
  ) {
    super(message, "VALIDATION");
  }
}

export class AppointmentTimeConflictError extends DomainError {
  constructor(
    message = "The selected time slot is no longer available for this collaborator.",
  ) {
    super(message, "CONFLICT");
  }
}

export class AppointmentNotReschedulableError extends DomainError {
  constructor(status: string) {
    super(
      `Cannot reschedule an appointment with status ${status}.`,
      "CONFLICT",
    );
  }
}

export class AppointmentSnapshotValidationError extends DomainError {
  constructor(message = "Invalid service or commission snapshot values.") {
    super(message, "VALIDATION");
  }
}

export class SchedulingCompanyNotFoundError extends DomainError {
  constructor(message = "Active company not found.") {
    super(message, "NOT_FOUND");
  }
}

export class SchedulingServiceNotFoundError extends DomainError {
  constructor(message = "Active service not found in this company.") {
    super(message, "NOT_FOUND");
  }
}

export class SchedulingCollaboratorNotFoundError extends DomainError {
  constructor(message = "Active collaborator not found in this company.") {
    super(message, "NOT_FOUND");
  }
}

export class CollaboratorNotEnabledForServiceError extends DomainError {
  constructor(
    message = "Collaborator is not enabled to perform the selected service.",
  ) {
    super(message, "NOT_FOUND");
  }
}

export class ScheduleBlockNotFoundError extends DomainError {
  constructor(message = "Schedule block not found.") {
    super(message, "NOT_FOUND");
  }
}

export class AppointmentNotFoundError extends DomainError {
  constructor(message = "Appointment not found.") {
    super(message, "NOT_FOUND");
  }
}

export class UnauthorizedSchedulingActionError extends DomainError {
  constructor(
    message = "You do not have permission to perform this scheduling action.",
  ) {
    super(message, "FORBIDDEN");
  }
}
