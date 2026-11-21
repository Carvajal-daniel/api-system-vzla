import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import type { AppointmentStatusValue } from "../../../../appointments/domain/value-objects/appointment-status.vo.js";
import {
  collectionErrors, type AppointmentCollections, type CollectionsRepository,
} from "../../../application/collections.use-cases.js";
import { CollectionsError, type Receipt, type Receivable } from "../../../domain/collections.js";
import { listCommissionDeductions } from "./commission-deductions.js";
import { FinancialDocumentTable, ReceiptTable } from "../schema/collections-schema.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Query = typeof db | Transaction;

const notFound = () => new CollectionsError("NOT_FOUND", collectionErrors.missing);
const asReceipt = ({ id, amountInCents, method, effectiveOn, recordedAt, recordedBy, requestKey,
  position, reversesReceiptId, reason }: typeof ReceiptTable.$inferSelect): Receipt => ({
  id, amountInCents, method, effectiveOn, recordedAt, recordedBy, requestKey, position, reversesReceiptId, reason,
});

const appointmentProjection = {
  id: AppointmentTable.id,
  status: AppointmentTable.status,
  collaboratorId: AppointmentTable.collaboratorId,
  clientName: AppointmentTable.clientName,
  serviceName: AppointmentTable.serviceNameSnapshot,
  price: AppointmentTable.servicePriceInCentsSnapshot,
  rate: AppointmentTable.commissionPercentageSnapshot,
  historyDate: sql<string>`to_char(coalesce(${AppointmentTable.completedAt}, ${AppointmentTable.startsAt}) at time zone ${CompanyTable.timezone}, 'YYYY-MM-DD')`,
  today: sql<string>`to_char(now() at time zone ${CompanyTable.timezone}, 'YYYY-MM-DD')`,
  openedOn: CompanyTable.financeOpenedOn,
  currency: CompanyTable.currency,
  document: FinancialDocumentTable,
};

function getAppointment(query: Query, companyId: string, appointmentId: string) {
  return query.select(appointmentProjection).from(AppointmentTable)
    .innerJoin(CompanyTable, eq(CompanyTable.id, AppointmentTable.companyId))
    .leftJoin(FinancialDocumentTable, and(
      eq(FinancialDocumentTable.companyId, AppointmentTable.companyId),
      eq(FinancialDocumentTable.appointmentId, AppointmentTable.id),
    ))
    .where(and(eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, appointmentId)));
}

function toReceivable(row: Awaited<ReturnType<typeof getAppointment>>[number]): Receivable {
  const historical = row.status === "COMPLETED" && row.historyDate < row.openedOn;
  return {
    appointmentId: row.id,
    status: row.status as AppointmentStatusValue,
    clientName: row.clientName,
    serviceName: row.serviceName,
    currency: row.document?.currency ?? row.currency,
    netInCents: row.document?.netInCents ?? row.price,
    historical,
    generatedCommissionInCents: row.status === "COMPLETED"
      ? row.document?.generatedCommissionInCents ?? Math.round(row.price * row.rate / 100) : null,
    commissionPaidAt: row.document?.commissionPaidAt ?? null,
  };
}

async function listForDocument(query: Query, companyId: string, documentId: string | undefined) {
  if (!documentId) return [];
  const rows = await query.select().from(ReceiptTable)
    .where(and(eq(ReceiptTable.companyId, companyId), eq(ReceiptTable.documentId, documentId)))
    .orderBy(asc(ReceiptTable.effectiveOn), asc(ReceiptTable.recordedAt), asc(ReceiptTable.position), asc(ReceiptTable.id));
  return rows.map(asReceipt);
}

export class DrizzleCollectionsRepository implements CollectionsRepository {
  async detail(companyId: string, appointmentId: string) {
    return db.transaction(async (tx) => {
      const [row] = await getAppointment(tx, companyId, appointmentId);
      if (!row) throw notFound();
      return { receivable: toReceivable(row), receipts: await listForDocument(tx, companyId, row.document?.id) };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  async transact<T>(
    companyId: string,
    target: { appointmentId: string } | { receiptId: string },
    work: (context: AppointmentCollections) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      // Serialize financial commands, currency changes and commission generation in a consistent lock order.
      const [company] = await tx.select({ id: CompanyTable.id }).from(CompanyTable)
        .where(eq(CompanyTable.id, companyId)).for("update");
      if (!company) throw notFound();

      let appointmentId: string;
      if ("receiptId" in target) {
        const [match] = await tx.select({ appointmentId: FinancialDocumentTable.appointmentId })
          .from(ReceiptTable).innerJoin(FinancialDocumentTable, and(
            eq(FinancialDocumentTable.companyId, ReceiptTable.companyId),
            eq(FinancialDocumentTable.id, ReceiptTable.documentId),
          )).where(and(eq(ReceiptTable.companyId, companyId), eq(ReceiptTable.id, target.receiptId)));
        if (!match) throw notFound();
        appointmentId = match.appointmentId;
      } else {
        appointmentId = target.appointmentId;
      }

      // Read the document after acquiring the appointment row lock.
      const [appointment] = await tx.select({ id: AppointmentTable.id }).from(AppointmentTable)
        .where(and(eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, appointmentId))).for("update");
      if (!appointment) throw notFound();
      const [row] = await getAppointment(tx, companyId, appointmentId);
      if (!row) throw notFound();
      const receivable = toReceivable(row);
      const receipts = await listForDocument(tx, companyId, row.document?.id);

      async function ensureDocument() {
        if (row!.document) return row!.document.id;
        const [created] = await tx.insert(FinancialDocumentTable).values({
          companyId, appointmentId, currency: receivable.currency, netInCents: receivable.netInCents,
          generatedCommissionInCents: receivable.generatedCommissionInCents,
        }).returning({ id: FinancialDocumentTable.id });
        return created!.id;
      }

      return work({
        receivable,
        receipts,
        openedOn: row.openedOn,
        today: row.today,
        async getRequest(key) {
          const rows = await tx.select({ row: ReceiptTable, appointmentId: FinancialDocumentTable.appointmentId })
            .from(ReceiptTable).innerJoin(FinancialDocumentTable, and(
              eq(FinancialDocumentTable.companyId, ReceiptTable.companyId),
              eq(FinancialDocumentTable.id, ReceiptTable.documentId),
            )).where(and(eq(ReceiptTable.companyId, companyId), eq(ReceiptTable.requestKey, key)))
            .orderBy(asc(ReceiptTable.position));
          return rows.map(({ row, appointmentId }) => ({ ...asReceipt(row), appointmentId }));
        },
        async addReceipts(items) {
          const documentId = await ensureDocument();
          const rows = await tx.insert(ReceiptTable).values(
            items.map((item) => ({ ...item, companyId, documentId })),
          ).returning();
          return rows.map(asReceipt);
        },
        async markCommissionPaid(actorId) {
          const open = await listCommissionDeductions(tx, companyId, { collaboratorId: row!.collaboratorId, to: row!.today }, true);
          if (open.length) throw new CollectionsError("CONFLICT", "FINANCE_COMMISSION_USE_BATCH");
          await ensureDocument();
          const paidAt = new Date();
          await tx.update(FinancialDocumentTable).set({ commissionPaidAt: paidAt, commissionPaidBy: actorId })
            .where(and(eq(FinancialDocumentTable.companyId, companyId), eq(FinancialDocumentTable.appointmentId, appointmentId)));
          return paidAt;
        },
      });
    });
  }

  async list(companyId: string, filter: { from?: string | undefined; to?: string | undefined;
    appointmentId?: string | undefined; collaboratorId?: string | undefined; page: number }) {
    const perPage = 50;
    const rows = await db.select({
      receipt: ReceiptTable, appointmentId: FinancialDocumentTable.appointmentId,
      currency: FinancialDocumentTable.currency, clientName: AppointmentTable.clientName,
      serviceName: AppointmentTable.serviceNameSnapshot,
    }).from(ReceiptTable).innerJoin(FinancialDocumentTable, and(
      eq(FinancialDocumentTable.companyId, ReceiptTable.companyId),
      eq(FinancialDocumentTable.id, ReceiptTable.documentId),
    )).innerJoin(AppointmentTable, and(
      eq(AppointmentTable.companyId, FinancialDocumentTable.companyId),
      eq(AppointmentTable.id, FinancialDocumentTable.appointmentId),
    )).where(and(
      eq(ReceiptTable.companyId, companyId),
      filter.from ? gte(ReceiptTable.effectiveOn, filter.from) : undefined,
      filter.to ? lte(ReceiptTable.effectiveOn, filter.to) : undefined,
      filter.appointmentId ? eq(FinancialDocumentTable.appointmentId, filter.appointmentId) : undefined,
      filter.collaboratorId ? eq(AppointmentTable.collaboratorId, filter.collaboratorId) : undefined,
    )).orderBy(desc(ReceiptTable.effectiveOn), desc(ReceiptTable.recordedAt), desc(ReceiptTable.id))
      .limit(perPage + 1).offset((filter.page - 1) * perPage);
    return { items: rows.slice(0, perPage).map(({ receipt, ...extra }) => ({ ...asReceipt(receipt), ...extra })),
      hasMore: rows.length > perPage };
  }
}
