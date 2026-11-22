import { and, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { AuthEmailAlreadyInUseError } from "../../../domain/errors/auth-errors.js";
import type {
  AuthCollaboratorRecord,
  AuthIdentityRecord,
  AuthIdentityRepository,
  AuthOwnerRecord,
  CreateOwnerCompanyRecord,
} from "../../../domain/repositories/auth-identity.repository.js";

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export class DrizzleAuthIdentityRepository implements AuthIdentityRepository {
  async existsEmailInUse(email: string): Promise<boolean> {
    const [companyRow, collaboratorRow] = await Promise.all([
      db
        .select({ id: CompanyTable.id })
        .from(CompanyTable)
        .where(eq(CompanyTable.email, email))
        .limit(1),
      db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.email, email))
        .limit(1),
    ]);

    return companyRow.length > 0 || collaboratorRow.length > 0;
  }

  async createOwnerCompany(record: CreateOwnerCompanyRecord): Promise<void> {
    try {
      await db.insert(CompanyTable).values({
        id: record.id,
        companyName: record.companyName,
        name: record.name,
        phone: record.phone,
        email: record.email,
        password: record.passwordHash,
        isActive: record.isActive,
        ...(record.timezone !== undefined ? { timezone: record.timezone } : {}),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    } catch (error) {
      // Protege contra condição de corrida quando dois registros usam o mesmo e-mail simultaneamente.
      if (isUniqueViolationError(error)) {
        throw new AuthEmailAlreadyInUseError();
      }
      throw error;
    }
  }

  async findByEmail(email: string): Promise<AuthIdentityRecord | null> {
    const companyRows = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        companyTimezone: CompanyTable.timezone,
        companyCurrency: CompanyTable.currency,
        name: CompanyTable.name,
        phone: CompanyTable.phone,
        email: CompanyTable.email,
        passwordHash: CompanyTable.password,
        isActive: CompanyTable.isActive,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.email, email))
      .limit(1);

    const company = companyRows[0];
    if (company) {
      return {
        role: "OWNER",
        id: company.id,
        companyId: company.id,
        companyName: company.companyName,
        companyTimezone: company.companyTimezone,
      companyCurrency: company.companyCurrency,
        name: company.name,
        phone: company.phone,
        email: company.email,
        passwordHash: company.passwordHash,
        isActive: company.isActive,
      };
    }

    const collaboratorRows = await db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        companyName: CompanyTable.companyName,
        companyTimezone: CompanyTable.timezone,
        companyCurrency: CompanyTable.currency,
        companyIsActive: CompanyTable.isActive,
        name: CollaboratorTable.name,
        phone: CollaboratorTable.phone,
        email: CollaboratorTable.email,
        passwordHash: CollaboratorTable.password,
        specialty: CollaboratorTable.specialty,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
      })
      .from(CollaboratorTable)
      .innerJoin(CompanyTable, eq(CollaboratorTable.companyId, CompanyTable.id))
      .where(eq(CollaboratorTable.email, email))
      .limit(1);

    const collaborator = collaboratorRows[0];
    if (!collaborator) {
      return null;
    }

    return {
      role: "COLLABORATOR",
      id: collaborator.id,
      companyId: collaborator.companyId,
      companyName: collaborator.companyName,
      companyTimezone: collaborator.companyTimezone,
      companyCurrency: collaborator.companyCurrency,
      companyIsActive: collaborator.companyIsActive,
      name: collaborator.name,
      phone: collaborator.phone,
      email: collaborator.email,
      passwordHash: collaborator.passwordHash,
      specialty: collaborator.specialty,
      commissionPercentage: Number(collaborator.commissionPercentage),
      isActive: collaborator.isActive,
    };
  }

  async findOwnerById(companyId: string): Promise<AuthOwnerRecord | null> {
    const rows = await db
      .select({
        id: CompanyTable.id,
        companyName: CompanyTable.companyName,
        companyTimezone: CompanyTable.timezone,
        companyCurrency: CompanyTable.currency,
        name: CompanyTable.name,
        phone: CompanyTable.phone,
        email: CompanyTable.email,
        passwordHash: CompanyTable.password,
        isActive: CompanyTable.isActive,
        avatarUrl: CompanyTable.avatarUrl,
        operatingDays: CompanyTable.operatingDays,
        operatingSchedule: CompanyTable.operatingSchedule,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    const company = rows[0];
    if (!company) {
      return null;
    }

    return {
      role: "OWNER",
      id: company.id,
      companyId: company.id,
      companyName: company.companyName,
      companyTimezone: company.companyTimezone,
      companyCurrency: company.companyCurrency,
      name: company.name,
      phone: company.phone,
      email: company.email,
      passwordHash: company.passwordHash,
      isActive: company.isActive,
      avatarUrl: company.avatarUrl ?? null,
      operatingDays: company.operatingDays ?? null,
      operatingSchedule: (company.operatingSchedule as AuthOwnerRecord["operatingSchedule"]) ?? null,
    };
  }

  async findCollaboratorById(
    collaboratorId: string,
    companyId: string,
  ): Promise<AuthCollaboratorRecord | null> {
    const rows = await db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        companyName: CompanyTable.companyName,
        companyTimezone: CompanyTable.timezone,
        companyCurrency: CompanyTable.currency,
        companyIsActive: CompanyTable.isActive,
        companyAvatarUrl: CompanyTable.avatarUrl,
        companyOperatingDays: CompanyTable.operatingDays,
        companyOperatingSchedule: CompanyTable.operatingSchedule,
        name: CollaboratorTable.name,
        phone: CollaboratorTable.phone,
        email: CollaboratorTable.email,
        passwordHash: CollaboratorTable.password,
        specialty: CollaboratorTable.specialty,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      })
      .from(CollaboratorTable)
      .innerJoin(CompanyTable, eq(CollaboratorTable.companyId, CompanyTable.id))
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    const collaborator = rows[0];
    if (!collaborator) {
      return null;
    }

    return {
      role: "COLLABORATOR",
      id: collaborator.id,
      companyId: collaborator.companyId,
      companyName: collaborator.companyName,
      companyTimezone: collaborator.companyTimezone,
      companyCurrency: collaborator.companyCurrency,
      companyIsActive: collaborator.companyIsActive,
      companyAvatarUrl: collaborator.companyAvatarUrl,
      companyOperatingDays: collaborator.companyOperatingDays,
      companyOperatingSchedule: (collaborator.companyOperatingSchedule as AuthOwnerRecord["operatingSchedule"]) ?? null,
      name: collaborator.name,
      phone: collaborator.phone,
      email: collaborator.email,
      passwordHash: collaborator.passwordHash,
      specialty: collaborator.specialty,
      commissionPercentage: Number(collaborator.commissionPercentage),
      isActive: collaborator.isActive,
      avatarUrl: collaborator.avatarUrl ?? null,
    };
  }

  async updateOwnerProfile(
    companyId: string,
    data: {
      name?: string;
      companyName?: string;
      phone?: string;
      avatarUrl?: string | null;
      operatingDays?: string | null;
      operatingSchedule?: AuthOwnerRecord["operatingSchedule"];
    },
  ): Promise<void> {
    await db
      .update(CompanyTable)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.companyName !== undefined ? { companyName: data.companyName } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        ...(data.operatingDays !== undefined ? { operatingDays: data.operatingDays } : {}),
        ...(data.operatingSchedule !== undefined
          ? { operatingSchedule: data.operatingSchedule }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(CompanyTable.id, companyId));
  }

  async updateCollaboratorProfile(
    collaboratorId: string,
    companyId: string,
    data: { name?: string; avatarUrl?: string | null },
  ): Promise<void> {
    await db
      .update(CollaboratorTable)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      })
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      );
  }

  async updateOwnerPassword(companyId: string, passwordHash: string): Promise<void> {
    await db
      .update(CompanyTable)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(CompanyTable.id, companyId));
  }

  async updateCollaboratorPassword(
    collaboratorId: string,
    companyId: string,
    passwordHash: string,
  ): Promise<void> {
    await db
      .update(CollaboratorTable)
      .set({ password: passwordHash })
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      );
  }
}
