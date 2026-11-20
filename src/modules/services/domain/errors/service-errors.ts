import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class InvalidServiceNameError extends DomainError {
  constructor(message = "Service name is required and must be between 1 and 120 characters.") {
    super(message, "VALIDATION");
  }
}

export class InvalidServiceDescriptionError extends DomainError {
  constructor(message = "Service description must be at most 500 characters.") {
    super(message, "VALIDATION");
  }
}

export class InvalidServiceDurationError extends DomainError {
  constructor(message = "Service duration must be a positive integer in minutes.") {
    super(message, "VALIDATION");
  }
}

export class InvalidServicePriceError extends DomainError {
  constructor(message = "Service price must be a non-negative integer in cents.") {
    super(message, "VALIDATION");
  }
}

export class ServiceNameAlreadyExistsError extends DomainError {
  constructor(message = "A service with this name already exists in this company.") {
    super(message, "CONFLICT");
  }
}

export class ServiceNotFoundError extends DomainError {
  constructor(message = "Service not found.") {
    super(message, "NOT_FOUND");
  }
}

export class UnauthorizedServiceActionError extends DomainError {
  constructor(message = "Only company owners are allowed to perform this action.") {
    super(message, "FORBIDDEN");
  }
}

export class InvalidCommissionPercentageError extends DomainError {
  constructor(
    message = "Commission percentage must be between 0 and 100 with at most two decimal places.",
  ) {
    super(message, "VALIDATION");
  }
}

export class CollaboratorServiceAlreadyExistsError extends DomainError {
  constructor(message = "This collaborator is already linked to the service.") {
    super(message, "CONFLICT");
  }
}

export class CollaboratorServiceNotFoundError extends DomainError {
  constructor(message = "Collaborator-service link not found.") {
    super(message, "NOT_FOUND");
  }
}

export class CollaboratorNotFoundError extends DomainError {
  constructor(message = "Active collaborator not found in this company.") {
    super(message, "NOT_FOUND");
  }
}

export class PublicCompanyNotFoundError extends DomainError {
  constructor(message = "Company not found.") {
    super(message, "NOT_FOUND");
  }
}
