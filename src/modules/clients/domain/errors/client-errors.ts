import { DomainError } from "../../../../shared/Errors/domain-error.js";

export class ClientNotFoundError extends DomainError {
  constructor(message = "Cliente não encontrado.") {
    super(message, "NOT_FOUND", "CLIENT_NOT_FOUND");
  }
}

export class ClientPhoneAlreadyExistsError extends DomainError {
  constructor(message = "Já existe um cliente cadastrado com este telefone.") {
    super(message, "CONFLICT", "CLIENT_PHONE_ALREADY_EXISTS");
  }
}

export class InvalidClientDataError extends DomainError {
  constructor(message = "Os dados informados para o cliente são inválidos.") {
    super(message, "VALIDATION", "INVALID_CLIENT_DATA");
  }
}
