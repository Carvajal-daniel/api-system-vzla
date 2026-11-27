import { DomainError } from "../../../shared/Errors/domain-error.js";

export class PublicPortalCompanyNotFoundError extends DomainError {
  constructor() {
    super(
      "Estabelecimento não encontrado ou indisponível.",
      "NOT_FOUND",
      "PUBLIC_PORTAL_COMPANY_NOT_FOUND",
    );
  }
}

export class PublicPortalPaymentProviderUnavailableError extends DomainError {
  constructor() {
    super(
      "O pagamento online está temporariamente indisponível para este estabelecimento.",
      "CONFLICT",
      "PAYMENT_PROVIDER_UNAVAILABLE",
    );
  }
}

export class PublicPortalDocumentRequiredError extends DomainError {
  constructor() {
    super(
      "Informe seu CPF para gerar o Pix do sinal.",
      "UNPROCESSABLE_ENTITY",
      "DOCUMENT_REQUIRED_FOR_PIX",
    );
  }
}

export class PublicPortalPixChargeError extends DomainError {
  constructor(
    message: string,
    code: "UNPROCESSABLE_ENTITY" | "BAD_GATEWAY" = "BAD_GATEWAY",
    reasonCode = "PIX_DEPOSIT_FAILED",
  ) {
    super(message, code, reasonCode);
  }
}
