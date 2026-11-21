import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { FinancialDocumentTable, ReceiptTable } from "../schema/collections-schema.js";

const signedAmount = sql<number>`case when ${ReceiptTable.reversesReceiptId} is null then ${ReceiptTable.amountInCents} else -${ReceiptTable.amountInCents} end`;
const collected = sql<number>`coalesce(sum(${signedAmount}), 0)`.mapWith(Number);

export function readCollectionTotals(companyId: string, from: string, to: string, appointmentRange: SQL | undefined, collaboratorId?: string) {
  const cohort = collaboratorId ? eq(AppointmentTable.collaboratorId, collaboratorId) : undefined;
  return Promise.all([
    db.select({
      date: ReceiptTable.effectiveOn, method: ReceiptTable.method, collectedInCents: collected,
    }).from(ReceiptTable).innerJoin(FinancialDocumentTable, and(
      eq(FinancialDocumentTable.companyId, ReceiptTable.companyId),
      eq(FinancialDocumentTable.id, ReceiptTable.documentId),
    )).innerJoin(AppointmentTable, and(
      eq(AppointmentTable.companyId, FinancialDocumentTable.companyId),
      eq(AppointmentTable.id, FinancialDocumentTable.appointmentId),
    )).where(and(eq(ReceiptTable.companyId, companyId), gte(ReceiptTable.effectiveOn, from),
      lte(ReceiptTable.effectiveOn, to), cohort))
      .groupBy(ReceiptTable.effectiveOn, ReceiptTable.method).orderBy(asc(ReceiptTable.effectiveOn)),
    db.select({
      appointmentId: FinancialDocumentTable.appointmentId,
      generatedCommissionInCents: FinancialDocumentTable.generatedCommissionInCents,
      netInCents: FinancialDocumentTable.netInCents,
      commissionPaidAt: FinancialDocumentTable.commissionPaidAt,
      movements: sql<number>`count(${ReceiptTable.id})`.mapWith(Number),
      collectedInCents: collected,
    }).from(FinancialDocumentTable).innerJoin(AppointmentTable, and(
      eq(AppointmentTable.companyId, FinancialDocumentTable.companyId),
      eq(AppointmentTable.id, FinancialDocumentTable.appointmentId),
    )).leftJoin(ReceiptTable, and(eq(ReceiptTable.companyId, FinancialDocumentTable.companyId),
      eq(ReceiptTable.documentId, FinancialDocumentTable.id)))
      .where(and(eq(FinancialDocumentTable.companyId, companyId), appointmentRange, cohort))
      .groupBy(FinancialDocumentTable.id),
  ]);
}
