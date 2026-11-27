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
