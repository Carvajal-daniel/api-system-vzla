import { eq, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { getLocalDateTimeParts } from "../../../../appointments/domain/services/timezone-utils.js";
import { SaasTelemetryTable } from "../schema/saas-telemetry-schema.js";

type TelemetryWrite = Omit<typeof SaasTelemetryTable.$inferInsert, "companyId" | "date">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function recordSaasTelemetry(
  tx: Transaction,
  companyId: string,
  now: Date,
  metrics: TelemetryWrite,
): Promise<void> {
  const [company] = await tx.select({ timezone: CompanyTable.timezone })
    .from(CompanyTable).where(eq(CompanyTable.id, companyId));
  if (!company) throw new Error("Tenant not found for SaaS telemetry");

  const date = getLocalDateTimeParts(now, company.timezone).dateString;
  await tx.insert(SaasTelemetryTable).values({ companyId, date, ...metrics }).onConflictDoUpdate({
    target: [SaasTelemetryTable.companyId, SaasTelemetryTable.date],
    set: {
      aiTurnsL0: sql`${SaasTelemetryTable.aiTurnsL0} + excluded.ai_turns_l0`,
      aiTurnsL1: sql`${SaasTelemetryTable.aiTurnsL1} + excluded.ai_turns_l1`,
      aiTurnsL2: sql`${SaasTelemetryTable.aiTurnsL2} + excluded.ai_turns_l2`,
      tokensInput: sql`${SaasTelemetryTable.tokensInput} + excluded.tokens_input`,
      tokensOutput: sql`${SaasTelemetryTable.tokensOutput} + excluded.tokens_output`,
      appointmentsCreatedByAi: sql`${SaasTelemetryTable.appointmentsCreatedByAi} + excluded.appointments_created_by_ai`,
      appointmentsCreatedManual: sql`${SaasTelemetryTable.appointmentsCreatedManual} + excluded.appointments_created_manual`,
      activeClubSubscribers: sql`coalesce(excluded.active_club_subscribers, ${SaasTelemetryTable.activeClubSubscribers})`,
      gmvCents: sql`${SaasTelemetryTable.gmvCents} + excluded.gmv_cents`,
    },
  });
}
