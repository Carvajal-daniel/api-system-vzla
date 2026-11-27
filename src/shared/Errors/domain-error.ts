export type DomainErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "BAD_GATEWAY"
  | "SERVICE_UNAVAILABLE";

export abstract class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: DomainErrorCode,
    public readonly reasonCode?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
