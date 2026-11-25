import { randomUUID } from "node:crypto";
import { Phone } from "../../../../shared/value-objects/phone.value-object.js";
import { InvalidClientDataError } from "../errors/client-errors.js";

export interface ClientProps {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  tags: string[];
  notes: string | null;
  lastVisitAt: Date | null;
  totalSpentCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientParams {
  companyId: string;
  name: string;
  phone: string;
  email?: string | null | undefined;
  birthDate?: string | null | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
}

export interface UpdateClientParams {
  name?: string | undefined;
  phone?: string | undefined;
  email?: string | null | undefined;
  birthDate?: string | null | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SIMPLE_EMAIL_REGEX = /^\S+@[^\s@]+\.\S+$/;

function normalizeTags(tags?: string[]): string[] {
  if (!tags) return [];
  const unique = new Set<string>();
  for (const tag of tags) {
    const cleaned = tag.trim().toLowerCase();
    if (cleaned.length > 0 && cleaned.length <= 40) {
      unique.add(cleaned);
    }
  }
  return Array.from(unique);
}

function normalizeEmail(email?: string | null): string | null {
  if (email === undefined || email === null) return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return null;
  if (!SIMPLE_EMAIL_REGEX.test(trimmed)) {
    throw new InvalidClientDataError("O e-mail informado é inválido.");
  }
  return trimmed;
}

function normalizeBirthDate(birthDate?: string | null): string | null {
  if (birthDate === undefined || birthDate === null) return null;
  const trimmed = birthDate.trim();
  if (!trimmed) return null;
  if (!ISO_DATE_REGEX.test(trimmed)) {
    throw new InvalidClientDataError(
      "A data de nascimento deve estar no formato YYYY-MM-DD.",
    );
  }
  return trimmed;
}

// Entidade de domínio do cliente normalizado, garantindo invariantes de nome, telefone (VO Phone) e isolamento por empresa.
export class Client {
  private readonly props: ClientProps;

  private constructor(props: ClientProps) {
    this.props = props;
  }

  public static create(params: CreateClientParams): Client {
    const trimmedName = params.name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 160) {
      throw new InvalidClientDataError(
        "O nome do cliente deve ter entre 2 e 160 caracteres.",
      );
    }

    const normalizedPhone = Phone.create(params.phone).value;
    const now = new Date();

    return new Client({
      id: randomUUID(),
      companyId: params.companyId,
      name: trimmedName,
      phone: normalizedPhone,
      email: normalizeEmail(params.email),
      birthDate: normalizeBirthDate(params.birthDate),
      tags: normalizeTags(params.tags),
      notes: params.notes?.trim() ? params.notes.trim() : null,
      lastVisitAt: null,
      totalSpentCents: 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  public static restore(props: ClientProps): Client {
    return new Client(props);
  }

  public get id(): string {
    return this.props.id;
  }

  public get companyId(): string {
    return this.props.companyId;
  }

  public get name(): string {
    return this.props.name;
  }

  public get phone(): string {
    return this.props.phone;
  }

  public get email(): string | null {
    return this.props.email;
  }

  public get birthDate(): string | null {
    return this.props.birthDate;
  }

  public get tags(): string[] {
    return [...this.props.tags];
  }

  public get notes(): string | null {
    return this.props.notes;
  }

  public get lastVisitAt(): Date | null {
    return this.props.lastVisitAt;
  }

  public get totalSpentCents(): number {
    return this.props.totalSpentCents;
  }

  public get createdAt(): Date {
    return this.props.createdAt;
  }

  public get updatedAt(): Date {
    return this.props.updatedAt;
  }

  public update(params: UpdateClientParams): Client {
    const nextName =
      params.name !== undefined ? params.name.trim() : this.props.name;
    if (nextName.length < 2 || nextName.length > 160) {
      throw new InvalidClientDataError(
        "O nome do cliente deve ter entre 2 e 160 caracteres.",
      );
    }

    const nextPhone =
      params.phone !== undefined
        ? Phone.create(params.phone).value
        : this.props.phone;

    const nextEmail =
      params.email !== undefined
        ? normalizeEmail(params.email)
        : this.props.email;

    const nextBirthDate =
      params.birthDate !== undefined
        ? normalizeBirthDate(params.birthDate)
        : this.props.birthDate;

    const nextTags =
      params.tags !== undefined ? normalizeTags(params.tags) : this.props.tags;

    const nextNotes =
      params.notes !== undefined
        ? params.notes?.trim()
          ? params.notes.trim()
          : null
        : this.props.notes;

    return new Client({
      ...this.props,
      name: nextName,
      phone: nextPhone,
      email: nextEmail,
      birthDate: nextBirthDate,
      tags: nextTags,
      notes: nextNotes,
      updatedAt: new Date(),
    });
  }

  public toDTO() {
    return {
      id: this.props.id,
      companyId: this.props.companyId,
      name: this.props.name,
      phone: this.props.phone,
      email: this.props.email,
      birthDate: this.props.birthDate,
      tags: [...this.props.tags],
      notes: this.props.notes,
      lastVisitAt: this.props.lastVisitAt
        ? this.props.lastVisitAt.toISOString()
        : null,
      totalSpentCents: this.props.totalSpentCents,
      createdAt: this.props.createdAt.toISOString(),
      updatedAt: this.props.updatedAt.toISOString(),
    };
  }

  public toPersistence(): ClientProps {
    return {
      ...this.props,
      tags: [...this.props.tags],
    };
  }
}
