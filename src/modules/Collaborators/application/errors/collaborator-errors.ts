import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class CollaboratorEmailAlreadyInError extends Error {
  constructor() {
    super("Este e-mail já está cadastrado.");
  }
}

export class CollaboratorCompanyNotFoundError extends Error {
  constructor() {
    super("Empresa não encontrada.");
  }
}

export class CollaboratorRecordNotFoundError extends DomainError {
  constructor(message = "Collaborator not found in this company.") {
    super(message, "NOT_FOUND");
  }
}

export class CollaboratorNotFoundError extends CollaboratorRecordNotFoundError {}

export class CannotModifyOwnOwnerStatusError extends DomainError {
  constructor(message = "Owners cannot change their own account status through this endpoint.") {
    super(message, "FORBIDDEN");
  }
}

export class AwardAlreadyClosedError extends DomainError {
  constructor(referenceMonth: string) {
    super(`O prêmio de Funcionário do Mês para ${referenceMonth} já foi apurado.`, "CONFLICT");
  }
}

export class NoCollaboratorsToAwardError extends DomainError {
  constructor() {
    super("Não há colaboradores cadastrados para apurar o Funcionário do Mês.", "VALIDATION");
  }
}
