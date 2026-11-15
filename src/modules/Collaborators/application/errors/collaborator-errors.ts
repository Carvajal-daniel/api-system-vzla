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
