import { and, eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { ScheduleBlockTable } from "../../../../appointments/infra/database/schema/schedule-blocks-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorServiceTable } from "../../../../services/infra/database/schema/collaborator-services-schema.js";
import { WorkScheduleTable } from "../../../../work-schedules/infra/database/schema/work-schedules-schema.js";
import { CollaboratorEmailAlreadyInError } from "../../../application/errors/collaborator-errors.js";
import type { CollaboratorEntity } from "../../../domain/entities/collaborator.entity.js";
import type {
  CollaboratorRecord,
  CollaboratorsRepository,
} from "../../../domain/repository/collaborators.repository.interface.js";
import { CollaboratorTable } from "../schema/collaborators-schema.js";

function isUniqueViolationError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export class CollaboratorRepositoryDB implements CollaboratorsRepository {
  // Verifica unicidade global entre colaboradores e empresas para manter o login por e-mail sem ambiguidade.
  async existsByEmail(email: string): Promise<boolean> {
    const [collaboratorRow, companyRow] = await Promise.all([
      db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(eq(CollaboratorTable.email, email))
        .limit(1),
      db
        .select({ id: CompanyTable.id })
        .from(CompanyTable)
        .where(eq(CompanyTable.email, email))
        .limit(1),
    ]);

    return collaboratorRow.length > 0 || companyRow.length > 0;
  }

  async companyExistsById(companyId: string): Promise<boolean> {
    const result = await db
      .select({ id: CompanyTable.id })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    return result.length > 0;
  }

  async save(collaborator: CollaboratorEntity): Promise<void> {
    try {
      await db.insert(CollaboratorTable).values({
        id: collaborator.id,
        name: collaborator.name,
        email: collaborator.email,
        password: collaborator.password,
        phone: collaborator.phone,
        companyId: collaborator.companyId,
        specialty: collaborator.specialty,
        commissionPercentage: collaborator.commissionPercentage,
        isActive: collaborator.isActive,
      });
    } catch (error) {
      // Protege contra condição de corrida quando dois cadastros usam o mesmo e-mail simultaneamente.
      if (isUniqueViolationError(error)) {
        throw new CollaboratorEmailAlreadyInError();
      }
      throw error;
    }
  }

  async findAllByCompanyId(companyId: string): Promise<CollaboratorRecord[]> {
    const rows = await db
      .select({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        email: CollaboratorTable.email,
        phone: CollaboratorTable.phone,
        specialty: CollaboratorTable.specialty,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      })
      .from(CollaboratorTable)
      .where(eq(CollaboratorTable.companyId, companyId));

    return rows.map((row) => ({
      ...row,
      commissionPercentage: Number(row.commissionPercentage),
    }));
  }

  async updateStatusInCompany(
    collaboratorId: string,
    companyId: string,
    isActive: boolean,
  ): Promise<CollaboratorRecord | null> {
    const rows = await db
      .update(CollaboratorTable)
      .set({ isActive })
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .returning({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        email: CollaboratorTable.email,
        phone: CollaboratorTable.phone,
        specialty: CollaboratorTable.specialty,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      });

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      ...row,
      commissionPercentage: Number(row.commissionPercentage),
    };
  }

  async updateDetailsInCompany(
    collaboratorId: string,
    companyId: string,
    data: { name?: string; specialty?: string; commissionPercentage?: number },
  ): Promise<CollaboratorRecord | null> {
    const rows = await db
      .update(CollaboratorTable)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.specialty !== undefined ? { specialty: data.specialty } : {}),
        ...(data.commissionPercentage !== undefined
          ? { commissionPercentage: data.commissionPercentage }
          : {}),
      })
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .returning({
        id: CollaboratorTable.id,
        companyId: CollaboratorTable.companyId,
        name: CollaboratorTable.name,
        email: CollaboratorTable.email,
        phone: CollaboratorTable.phone,
        specialty: CollaboratorTable.specialty,
        commissionPercentage: CollaboratorTable.commissionPercentage,
        isActive: CollaboratorTable.isActive,
        avatarUrl: CollaboratorTable.avatarUrl,
      });

    const row = rows[0];
    if (!row) return null;

    return {
      ...row,
      commissionPercentage: Number(row.commissionPercentage),
    };
  }

  async deleteInCompany(
    collaboratorId: string,
    companyId: string,
    transferToCollaboratorId?: string,
  ): Promise<"deleted" | "not_found" | "has_appointments" | "destination_not_found"> {
    // Verifica se o colaborador a ser removido existe
    const existing = await db
      .select({ id: CollaboratorTable.id })
      .from(CollaboratorTable)
      .where(
        and(
          eq(CollaboratorTable.id, collaboratorId),
          eq(CollaboratorTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      return "not_found";
    }

    // Se informou profissional de destino para transferir agendamentos
    if (transferToCollaboratorId) {
      const destination = await db
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.id, transferToCollaboratorId),
            eq(CollaboratorTable.companyId, companyId),
            eq(CollaboratorTable.isActive, true),
          ),
        )
      .limit(1);

      if (destination.length === 0) {
        return "destination_not_found";
      }

      // Transfere todos os agendamentos vinculados ao novo profissional
      await db
        .update(AppointmentTable)
        .set({
          collaboratorId: transferToCollaboratorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.collaboratorId, collaboratorId),
          ),
        );
    } else {
      // Bloqueia exclusão física quando existem agendamentos vinculados e não foi solicitada transferência
      const linked = await db
        .select({ id: AppointmentTable.id })
        .from(AppointmentTable)
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.collaboratorId, collaboratorId),
          ),
        )
        .limit(1);

      if (linked.length > 0) {
        return "has_appointments";
      }
    }

    try {
      // Remove dependências vinculadas para garantir integridade relacional
      await db
        .delete(CollaboratorServiceTable)
        .where(
          and(
            eq(CollaboratorServiceTable.collaboratorId, collaboratorId),
            eq(CollaboratorServiceTable.companyId, companyId),
          ),
        );

      await db
        .delete(WorkScheduleTable)
        .where(
          and(
            eq(WorkScheduleTable.collaboratorId, collaboratorId),
            eq(WorkScheduleTable.companyId, companyId),
          ),
        );

      await db
        .delete(ScheduleBlockTable)
        .where(
          and(
            eq(ScheduleBlockTable.collaboratorId, collaboratorId),
            eq(ScheduleBlockTable.companyId, companyId),
          ),
        );

      const deleted = await db
        .delete(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.id, collaboratorId),
            eq(CollaboratorTable.companyId, companyId),
          ),
        )
        .returning({ id: CollaboratorTable.id });

      return deleted.length > 0 ? "deleted" : "not_found";
    } catch (error) {
      const candidate = error as { code?: unknown; cause?: { code?: unknown } };
      if (candidate?.code === "23503" || candidate?.cause?.code === "23503") {
        return "has_appointments";
      }
      throw error;
    }
  }
}
