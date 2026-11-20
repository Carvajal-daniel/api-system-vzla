import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class InvalidTimeOfDayError extends DomainError {
  constructor(message = "Time must be in valid 24-hour HH:MM format.") {
    super(message, "VALIDATION");
  }
}

export class InvalidDayOfWeekError extends DomainError {
  constructor(message = "Day of week must be an integer between 0 (Sunday) and 6 (Saturday).") {
    super(message, "VALIDATION");
  }
}

export class InvalidWorkScheduleTimeError extends DomainError {
  constructor(message = "Working day requires startTime and endTime with endTime after startTime.") {
    super(message, "VALIDATION");
  }
}

export class InvalidWorkScheduleBreakError extends DomainError {
  constructor(
    message = "Break interval must include both breakStart and breakEnd strictly within working hours.",
  ) {
    super(message, "VALIDATION");
  }
}

export class DuplicateWorkScheduleDayError extends DomainError {
  constructor(message = "Duplicate dayOfWeek entries are not allowed in the same request.") {
    super(message, "VALIDATION");
  }
}

export class WorkScheduleCollaboratorNotFoundError extends DomainError {
  constructor(message = "Collaborator not found in this company.") {
    super(message, "NOT_FOUND");
  }
}

export class UnauthorizedWorkScheduleActionError extends DomainError {
  constructor(message = "You do not have permission to access or modify this work schedule.") {
    super(message, "FORBIDDEN");
  }
}
