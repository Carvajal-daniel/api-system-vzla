import "dotenv/config";
import { asc, sql } from "drizzle-orm";
import { AppointmentTable } from "../../../modules/appointments/infra/database/schema/appointments-schema.js";
import { ClientTable } from "../../../modules/clients/infra/database/schema/clients-schema.js";
import { Phone } from "../../value-objects/phone.value-object.js";
import { db } from "../database.js";

export interface BackfillClientsSummary {
  appointmentsRead: number;
  uniqueClientsPrepared: number;
  insertedCount: number;
  skippedInvalidPhone: number;
}

interface AggregatedClient {
  companyId: string;
  name: string;
  phone: string;
  email: string | null;
  birthDate: string | null;
  lastVisitAt: Date | null;
  totalSpentCents: number;
  createdAt: Date;
  updatedAt: Date;
}

function extractOptionalDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function extractOptionalEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^\S+@[^\s@]+\.\S+$/.test(trimmed) ? trimmed : null;
}

/**
 * Rotina idempotente de backfill que lê agendamentos existentes e popula a tabela `clients`
 * sem duplicar telefones por empresa. Pode ser executada múltiplas vezes com segurança.
 */
export async function backfillClientsFromAppointments(): Promise<BackfillClientsSummary> {
  const appointments = await db
    .select({
      companyId: AppointmentTable.companyId,
      clientName: AppointmentTable.clientName,
      clientPhone: AppointmentTable.clientPhone,
      clientData: AppointmentTable.clientData,
      status: AppointmentTable.status,
      startsAt: AppointmentTable.startsAt,
      servicePriceInCentsSnapshot: AppointmentTable.servicePriceInCentsSnapshot,
      createdAt: AppointmentTable.createdAt,
      updatedAt: AppointmentTable.updatedAt,
    })
    .from(AppointmentTable)
    .orderBy(asc(AppointmentTable.createdAt));

  const aggregated = new Map<string, AggregatedClient>();
  let skippedInvalidPhone = 0;

  for (const row of appointments) {
    let normalizedPhone: string;
    try {
      normalizedPhone = Phone.create(row.clientPhone).value;
    } catch {
      skippedInvalidPhone += 1;
      continue;
    }

    const key = `${row.companyId}::${normalizedPhone}`;
    const existing = aggregated.get(key);
    const trimmedName = row.clientName.trim() || "Cliente";
    const clientData = row.clientData as Record<string, unknown> | null;
    const email = extractOptionalEmail(clientData?.email);
    const birthDate = extractOptionalDate(clientData?.birthDate);
    const isCompleted = row.status === "COMPLETED";

    if (!existing) {
      aggregated.set(key, {
        companyId: row.companyId,
        name: trimmedName,
        phone: normalizedPhone,
        email,
        birthDate,
        lastVisitAt: isCompleted ? row.startsAt : null,
        totalSpentCents: isCompleted ? Math.max(0, row.servicePriceInCentsSnapshot) : 0,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      continue;
    }

    // Mantém o nome mais recente quando houver atualização cadastral nos agendamentos
    if (trimmedName) {
      existing.name = trimmedName;
    }
    if (!existing.email && email) {
      existing.email = email;
    }
    if (!existing.birthDate && birthDate) {
      existing.birthDate = birthDate;
    }
    if (isCompleted) {
      existing.totalSpentCents += Math.max(0, row.servicePriceInCentsSnapshot);
      if (!existing.lastVisitAt || row.startsAt > existing.lastVisitAt) {
        existing.lastVisitAt = row.startsAt;
      }
    }
    if (row.createdAt < existing.createdAt) {
      existing.createdAt = row.createdAt;
    }
    if (row.updatedAt > existing.updatedAt) {
      existing.updatedAt = row.updatedAt;
    }
  }

  let insertedCount = 0;
  const entries = Array.from(aggregated.values());

  // Insere em lotes com ON CONFLICT DO NOTHING para garantir idempotência total
  const batchSize = 200;
  for (let offset = 0; offset < entries.length; offset += batchSize) {
    const batch = entries.slice(offset, offset + batchSize);
    const inserted = await db
      .insert(ClientTable)
      .values(
        batch.map((item) => ({
          companyId: item.companyId,
          name: item.name,
          phone: item.phone,
          email: item.email,
          birthDate: item.birthDate,
          tags: [],
          notes: null,
          lastVisitAt: item.lastVisitAt,
          totalSpentCents: item.totalSpentCents,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      )
      .onConflictDoNothing({
        target: [ClientTable.companyId, ClientTable.phone],
      })
      .returning({ id: ClientTable.id });

    insertedCount += inserted.length;
  }

  return {
    appointmentsRead: appointments.length,
    uniqueClientsPrepared: entries.length,
    insertedCount,
    skippedInvalidPhone,
  };
}

// Permite execução direta via CLI (`tsx src/shared/database/scripts/backfill-clients-from-appointments.ts`)
const isDirectExecution =
  process.argv[1]?.endsWith("backfill-clients-from-appointments.ts") ||
  process.argv[1]?.endsWith("backfill-clients-from-appointments.js");

if (isDirectExecution) {
  backfillClientsFromAppointments()
    .then(async (summary) => {
      console.log(
        JSON.stringify(
          {
            status: "ok",
            ...summary,
          },
          null,
          2,
        ),
      );
      await db.execute(sql`SELECT 1`);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("Failed to backfill clients from appointments:", error);
      process.exit(1);
    });
}
