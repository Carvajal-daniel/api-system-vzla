import { DomainError } from "../Errors/domain-error.js";

export class InvalidPhoneError extends DomainError {
  constructor(message = "O número de telefone informado é inválido.") {
    super(message, "VALIDATION");
  }
}

const E164_REGEX = /^\+[1-9]\d{9,14}$/;
const LOCAL_DIGITS_REGEX = /^\d{10,15}$/;

export class Phone {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value;
    Object.freeze(this);
  }

  /**
   * Normaliza e valida números de telefone suportando formatos internacionais E.164
   * (incluindo Brasil +55 e Venezuela +58) e mantendo retrocompatibilidade com números locais (10-15 dígitos).
   */
  public static create(value: string): Phone {
    const trimmed = (value || "").trim();
    const cleanPhone = trimmed.replace(/[\s().-]+/g, "");

    if (cleanPhone.startsWith("+")) {
      if (!E164_REGEX.test(cleanPhone)) {
        throw new InvalidPhoneError();
      }

      const digits = cleanPhone.slice(1);

      // Brasil (+55): código do país (2) + DDD (2) + número (8 ou 9 dígitos) = 12 ou 13 dígitos.
      if (digits.startsWith("55") && digits.length !== 12 && digits.length !== 13) {
        throw new InvalidPhoneError();
      }

      // Venezuela (+58): código do país (2) + código de área/operadora (3) + número (7 dígitos) = 12 dígitos.
      if (digits.startsWith("58") && digits.length !== 12) {
        throw new InvalidPhoneError();
      }

      return new Phone(cleanPhone);
    }

    if (!LOCAL_DIGITS_REGEX.test(cleanPhone)) {
      throw new InvalidPhoneError();
    }

    return new Phone(cleanPhone);
  }

  public get value(): string {
    return this._value;
  }
}
