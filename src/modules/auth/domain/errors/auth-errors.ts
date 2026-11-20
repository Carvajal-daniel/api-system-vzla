import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class AuthEmailAlreadyInUseError extends DomainError {
  constructor() {
    super("This email is already registered.", "CONFLICT");
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("Invalid email or password.", "UNAUTHORIZED");
  }
}

export class InactiveAccountError extends DomainError {
  constructor() {
    super("Account or company is inactive.", "FORBIDDEN");
  }
}

export class AuthenticatedActorNotFoundError extends DomainError {
  constructor() {
    super("Session is no longer valid.", "UNAUTHORIZED");
  }
}
