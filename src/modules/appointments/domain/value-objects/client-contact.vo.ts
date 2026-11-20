import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { InvalidClientNameError } from "../errors/appointment-errors.js";

export class ClientContact {
  private constructor(
    public readonly name: string,
    public readonly phone: string,
  ) {
    Object.freeze(this);
  }

  static create(rawName: string, rawPhone: string): ClientContact {
    const normalizedName = rawName.trim();
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      throw new InvalidClientNameError();
    }

    const validatedPhone = Phone.create(rawPhone);
    return new ClientContact(normalizedName, validatedPhone.value);
  }
}
