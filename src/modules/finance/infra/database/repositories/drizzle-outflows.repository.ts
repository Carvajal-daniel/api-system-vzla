import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { importOnce } from "../../../../../shared/database/import-once.js";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import type { CommissionDeductionInput, CommissionReport, ExpenseFilters, OutflowFilters, OutflowsRepository } from "../../../application/outflows.use-cases.js";
import type { AppointmentStatusValue } from "../../../../appointments/domain/value-objects/appointment-status.vo.js";
import { CollectionsError, getCommissionStatus } from "../../../domain/collections.js";
import {
  expensePayment, expenseStatus, priceExpense, type CommissionFilter, type ExpenseEdit, type ExpenseInput, type ExpensePayment,
  type PaidInput, type SettlementInput,
} from "../../../domain/outflows.js";
import { FinancialDocumentTable, ReceiptTable } from "../schema/collections-schema.js";
import { CommissionDeductionApplicationTable, CommissionDeductionTable, CommissionSettlementTable, ExpenseTable } from "../schema/outflows-schema.js";
import { expenseList, localDay, paymentInstant, type FinanceQuery } from "./outflow-projections.js";

import { listCommissionDeductions, listDeductionApplications } from "./commission-deductions.js";

const notFound = () => new CollectionsError("NOT_FOUND", "FINANCE_RECORD_NOT_FOUND");

async function companyPolicy(query: FinanceQuery, companyId: string, lock = false) {
  const lookup = query.select({
    timezone: CompanyTable.timezone,
    today: sql<string>`to_char(now() at time zone ${CompanyTable.timezone}, 'YYYY-MM-DD')`,
  }).from(CompanyTable).where(eq(CompanyTable.id, companyId));
  const [company] = await (lock ? lookup.for("update") : lookup);
  if (!company) throw notFound();
  return company;
}

function validatePaidDate(paidOn: string, today: string) {
  if (paidOn > today) throw new CollectionsError("VALIDATION", "FINANCE_INVALID_PAYMENT_DAY");
}

const signedReceipt = sql`case when ${ReceiptTable.reversesReceiptId} is null then ${ReceiptTable.amountInCents} else -${ReceiptTable.amountInCents} end`;
const received = sql<number>`coalesce((
  select sum(${signedReceipt}) from ${ReceiptTable}
  where ${ReceiptTable.companyId} = ${FinancialDocumentTable.companyId}
    and ${ReceiptTable.documentId} = ${FinancialDocumentTable.id}
), 0)`.mapWith(Number);

function commissionRows(query: FinanceQuery, companyId: string, timezone: string, filter: CommissionFilter, payableOnly = false) {
  const day = localDay(timezone, AppointmentTable.startsAt);
  return query.select({
    collaboratorId: AppointmentTable.collaboratorId,
    status: AppointmentTable.status,
    price: AppointmentTable.servicePriceInCentsSnapshot,
    rate: AppointmentTable.commissionPercentageSnapshot,
    documentId: FinancialDocumentTable.id,
    generated: sql<number>`coalesce(${FinancialDocumentTable.generatedCommissionInCents},
      round(${AppointmentTable.servicePriceInCentsSnapshot}::numeric * ${AppointmentTable.commissionPercentageSnapshot} / 100))`.mapWith(Number),
    settlementId: FinancialDocumentTable.commissionSettlementId,
    paidAt: FinancialDocumentTable.commissionPaidAt,
    net: FinancialDocumentTable.netInCents,
    collected: received,
  }).from(AppointmentTable).leftJoin(FinancialDocumentTable, and(
    eq(FinancialDocumentTable.companyId, AppointmentTable.companyId),
    eq(FinancialDocumentTable.appointmentId, AppointmentTable.id),
  )).where(and(
    eq(AppointmentTable.companyId, companyId),
    gte(day, sql`${filter.from}::date`), lte(day, sql`${filter.to}::date`),
    filter.collaboratorId ? eq(AppointmentTable.collaboratorId, filter.collaboratorId) : undefined,
    payableOnly ? and(eq(AppointmentTable.status, "COMPLETED"), isNull(FinancialDocumentTable.commissionPaidAt),
      isNull(FinancialDocumentTable.commissionSettlementId), gte(FinancialDocumentTable.generatedCommissionInCents, 1)) : undefined,
  ));
}

function sameExpense(existing: typeof ExpenseTable.$inferSelect, expected: ExpenseInput) {
  return existing.description === expected.description && existing.category === expected.category &&
    existing.expenseType === expected.expenseType && existing.amountCents === expected.amountCents &&
    existing.quantity === expected.quantity && existing.unitAmountCents === expected.unitAmountCents &&
    existing.dueDate === expected.dueDate && existing.isRecurring === expected.isRecurring &&
    existing.notes === expected.notes && existing.externalSourceType === expected.externalSourceType &&
    existing.externalSourceId === expected.externalSourceId;
}

export class DrizzleOutflowsRepository implements OutflowsRepository {
  async listExpenses(companyId: string, filters: ExpenseFilters) {
    const { today, timezone } = await companyPolicy(db, companyId);
    return expenseList(db, companyId, timezone, today, filters);
  }

  createExpense(companyId: string, input: ExpenseInput) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(tx, companyId, true);
      const existingKey = or(
        input.requestKey ? eq(ExpenseTable.requestKey, input.requestKey) : undefined,
        input.externalSourceType && input.externalSourceId ? and(
          eq(ExpenseTable.externalSourceType, input.externalSourceType),
          eq(ExpenseTable.externalSourceId, input.externalSourceId),
        ) : undefined,
      );
      if (existingKey) {
        const [existing] = await tx.select({
          row: ExpenseTable, paidOn: sql<string | null>`to_char(${localDay(timezone, ExpenseTable.paidAt)}, 'YYYY-MM-DD')`,
        }).from(ExpenseTable).where(and(eq(ExpenseTable.companyId, companyId), existingKey));
        if (existing) {
          if (!sameExpense(existing.row, input)) throw new CollectionsError("CONFLICT", "FINANCE_IDEMPOTENCY_CONFLICT");
          return { ...existing.row, paidOn: existing.paidOn, status: expenseStatus(existing.row.dueDate, existing.row.paidAt, today) };
        }
      }
      const [row] = await tx.insert(ExpenseTable).values({ ...input, companyId }).returning();
      return { ...row!, paidOn: null, status: expenseStatus(input.dueDate, null, today) };
    });
  }

  editExpense(companyId: string, id: string, changes: ExpenseEdit) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(tx, companyId, true);
      const scope = and(eq(ExpenseTable.companyId, companyId), eq(ExpenseTable.id, id));
      const [existing] = await tx.select({
        expense: ExpenseTable, paidOn: sql<string | null>`to_char(${localDay(timezone, ExpenseTable.paidAt)}, 'YYYY-MM-DD')`,
      }).from(ExpenseTable).where(scope);
      if (!existing) throw notFound();
      const { expense, paidOn } = existing;
      const { status, paymentMethod, paidOn: newPaidOn, ...fields } = changes;
      const merged = { ...expense, ...fields };
      const priced = priceExpense({
        ...merged,
        unitAmountCents: fields.amountCents !== undefined && fields.unitAmountCents === undefined ? null : merged.unitAmountCents,
      });
      if (expense.externalSourceType === "INVENTORY_MOVEMENT" && (priced.amountCents !== expense.amountCents ||
          priced.category !== expense.category || priced.quantity !== expense.quantity || priced.unitAmountCents !== expense.unitAmountCents)) {
        throw new CollectionsError("CONFLICT", "FINANCE_EXPENSE_INVENTORY_LINKED");
      }
      const payment = expensePayment({ status, paymentMethod, paidOn: newPaidOn },
        paidOn && expense.paymentMethod ? { paidOn, paymentMethod: expense.paymentMethod } : null);
      if (payment) validatePaidDate(payment.paidOn, today);
      const [updated] = await tx.update(ExpenseTable).set({
        ...fields, amountCents: priced.amountCents, unitAmountCents: priced.unitAmountCents, quantity: priced.quantity,
        status: payment ? "PAID" : "PENDING", paymentMethod: payment?.paymentMethod ?? null,
        paidAt: payment ? payment.paidOn === paidOn ? expense.paidAt : paymentInstant(payment.paidOn, timezone) : null,
      }).where(scope).returning();
      return { ...updated!, paidOn: payment?.paidOn ?? null, status: expenseStatus(updated!.dueDate, updated!.paidAt, today) };
    });
  }

  importExpenses(companyId: string, key: string, items: { expense: ExpenseInput; payment: ExpensePayment }[]) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(tx, companyId, true);
      return importOnce(tx, companyId, "EXPENSES", key, items, async () => {
        for (const { payment } of items) if (payment) validatePaidDate(payment.paidOn, today);
        await tx.insert(ExpenseTable).values(items.map(({ expense, payment }) => ({
          ...expense, companyId, status: payment ? "PAID" as const : "PENDING" as const,
          paidAt: payment ? paymentInstant(payment.paidOn, timezone) : null, paymentMethod: payment?.paymentMethod ?? null,
        })));
        return items.length;
      });
    });
  }

  payExpense(companyId: string, id: string, input: PaidInput) {
    return db.transaction(async (tx) => {
      const { today, timezone } = await companyPolicy(tx, companyId, true);
      validatePaidDate(input.paidOn, today);
      const scope = and(eq(ExpenseTable.companyId, companyId), eq(ExpenseTable.id, id));
      const [row] = await tx.select({
        expense: ExpenseTable, paidOn: sql<string | null>`to_char(${localDay(timezone, ExpenseTable.paidAt)}, 'YYYY-MM-DD')`,
      }).from(ExpenseTable).where(scope);
      if (!row) throw notFound();
      if (row.expense.paidAt) {
        if (row.paidOn !== input.paidOn || row.expense.paymentMethod !== input.paymentMethod) {
          throw new CollectionsError("CONFLICT", "FINANCE_EXPENSE_ALREADY_PAID");
        }
        return { ...row.expense, paidOn: row.paidOn };
      }
      const [updated] = await tx.update(ExpenseTable).set({
        paidAt: paymentInstant(input.paidOn, timezone), paymentMethod: input.paymentMethod, status: "PAID",
      }).where(scope).returning();
      return { ...updated!, paidOn: input.paidOn };
    });
  }

  deleteExpense(companyId: string, id: string) {
    return db.transaction(async (tx) => {
      await companyPolicy(tx, companyId, true);
      const scope = and(eq(ExpenseTable.companyId, companyId), eq(ExpenseTable.id, id));
      const [row] = await tx.select({ source: ExpenseTable.externalSourceType })
        .from(ExpenseTable).where(scope);
      if (!row) throw notFound();
      if (row.source === "INVENTORY_MOVEMENT") throw new CollectionsError("CONFLICT", "FINANCE_EXPENSE_INVENTORY_LINKED");
      await tx.delete(ExpenseTable).where(scope);
    });
  }

  listCommissionDeductions(companyId: string, filters: OutflowFilters) {
    return listCommissionDeductions(db, companyId, filters);
  }

  createCommissionDeduction(companyId: string, input: CommissionDeductionInput) {
    return db.transaction(async (tx) => {
      const { today } = await companyPolicy(tx, companyId, true);
      validatePaidDate(input.deductedAt, today);
      const [professional] = await tx.select({ id: CollaboratorTable.id }).from(CollaboratorTable).where(and(
        eq(CollaboratorTable.companyId, companyId), eq(CollaboratorTable.id, input.collaboratorId),
      ));
      if (!professional) throw notFound();
      const [created] = await tx.insert(CommissionDeductionTable).values({ ...input, companyId })
        .onConflictDoNothing().returning();
      if (created) return { ...created, openAmountCents: created.amountCents };

      const matches = await listCommissionDeductions(tx, companyId, {}, false, or(
        input.requestKey ? eq(CommissionDeductionTable.requestKey, input.requestKey) : undefined,
        input.externalSourceType && input.externalSourceId ? and(
          eq(CommissionDeductionTable.externalSourceType, input.externalSourceType),
          eq(CommissionDeductionTable.externalSourceId, input.externalSourceId),
        ) : undefined,
      ));
      const [existing] = matches;
      if (matches.length === 1 && existing && existing.collaboratorId === input.collaboratorId &&
          existing.description === input.description && existing.category === input.category &&
          existing.quantity === input.quantity && existing.unitAmountCents === input.unitAmountCents &&
          existing.amountCents === input.amountCents && existing.deductedAt === input.deductedAt &&
          existing.notes === input.notes && existing.externalSourceType === input.externalSourceType &&
          existing.externalSourceId === input.externalSourceId) return existing;
      throw new CollectionsError("CONFLICT", "FINANCE_IDEMPOTENCY_CONFLICT");
    });
  }

  deleteCommissionDeduction(companyId: string, id: string) {
    return db.transaction(async (tx) => {
      await companyPolicy(tx, companyId, true);
      const scope = and(eq(CommissionDeductionTable.companyId, companyId), eq(CommissionDeductionTable.id, id));
      const [row] = await listCommissionDeductions(tx, companyId, {}, false, scope);
      if (!row) throw notFound();
      if (row.externalSourceType === "INVENTORY_MOVEMENT") {
        throw new CollectionsError("CONFLICT", "FINANCE_EXPENSE_INVENTORY_LINKED");
      }
      if (row.settlementId || row.openAmountCents !== row.amountCents) {
        throw new CollectionsError("CONFLICT", "FINANCE_DEDUCTION_PROTECTED");
      }
      await tx.delete(CommissionDeductionTable).where(scope);
    });
  }

  async commissions(companyId: string, filters: OutflowFilters): Promise<CommissionReport> {
    const { timezone, today } = await companyPolicy(db, companyId);
    const first = today.slice(0, 7) + "-01";
    const monthEnd = new Date(first + "T00:00:00Z");
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    const period = { from: filters.from ?? first, to: filters.to ?? monthEnd.toISOString().slice(0, 10), collaboratorId: filters.collaboratorId };
    if (period.from > period.to) throw new CollectionsError("VALIDATION", "FINANCE_INVALID_PERIOD");
    const paidDay = localDay(timezone, FinancialDocumentTable.commissionPaidAt);
    const settlementDay = sql`timezone(${timezone}, ${CommissionSettlementTable.paidAt})::date`;

    const [people, rows, settlements, legacy, deductions] = await Promise.all([
      db.select({ collaboratorId: CollaboratorTable.id, name: CollaboratorTable.name }).from(CollaboratorTable).where(and(
        eq(CollaboratorTable.companyId, companyId),
        filters.collaboratorId ? eq(CollaboratorTable.id, filters.collaboratorId) : undefined,
      )).orderBy(asc(CollaboratorTable.name)),
      commissionRows(db, companyId, timezone, period),
      db.select({ settlement: CommissionSettlementTable, collaboratorName: CollaboratorTable.name })
        .from(CommissionSettlementTable).innerJoin(CollaboratorTable, and(
          eq(CommissionSettlementTable.collaboratorId, CollaboratorTable.id),
          eq(CommissionSettlementTable.companyId, CollaboratorTable.companyId),
        )).where(and(
          eq(CommissionSettlementTable.companyId, companyId),
          filters.collaboratorId ? eq(CommissionSettlementTable.collaboratorId, filters.collaboratorId) : undefined,
          gte(settlementDay, sql`${period.from}::date`), lte(settlementDay, sql`${period.to}::date`),
        )).orderBy(desc(CommissionSettlementTable.paidAt)),
      db.select({
        id: FinancialDocumentTable.id, collaboratorId: AppointmentTable.collaboratorId,
        collaboratorName: CollaboratorTable.name, amountCents: FinancialDocumentTable.generatedCommissionInCents,
        paidAt: FinancialDocumentTable.commissionPaidAt,
        periodStart: sql<string>`to_char(${localDay(timezone, AppointmentTable.startsAt)}, 'YYYY-MM-DD')`,
      }).from(FinancialDocumentTable).innerJoin(AppointmentTable, and(
        eq(AppointmentTable.companyId, FinancialDocumentTable.companyId), eq(AppointmentTable.id, FinancialDocumentTable.appointmentId),
      )).innerJoin(CollaboratorTable, and(
        eq(CollaboratorTable.companyId, AppointmentTable.companyId), eq(CollaboratorTable.id, AppointmentTable.collaboratorId),
      )).where(and(
        eq(FinancialDocumentTable.companyId, companyId), eq(AppointmentTable.status, "COMPLETED"),
        isNull(FinancialDocumentTable.commissionSettlementId),
        filters.collaboratorId ? eq(AppointmentTable.collaboratorId, filters.collaboratorId) : undefined,
        gte(paidDay, sql`${period.from}::date`), lte(paidDay, sql`${period.to}::date`),
      )),
      listCommissionDeductions(db, companyId, { collaboratorId: filters.collaboratorId, to: today }, true),
    ]);

    const settlementIds = [...new Set(rows.flatMap((row) => row.status === "COMPLETED" && row.settlementId ? [row.settlementId] : []))];
    const applications = await listDeductionApplications(db, companyId, settlementIds);
    const professionals: CommissionReport["professionals"] = people.map((person) => ({
      ...person, forecastInCents: 0, awaitingCollectionInCents: 0, payableInCents: 0, paidInCents: 0,
      deductionsInCents: 0, netPayableInCents: 0, deductions: [], appliedDeductions: [],
    }));
    const byId = new Map(professionals.map((person) => [person.collaboratorId, person]));
    for (const row of rows) {
      const person = byId.get(row.collaboratorId);
      if (!person) continue;
      if (row.status === "CONFIRMED" || row.status === "PENDING") person.forecastInCents += Math.round(row.price * row.rate / 100);
      const status = getCommissionStatus(row.status as AppointmentStatusValue, row.generated, row.paidAt, row.collected, row.net ?? row.price);
      if (status === "PAID") person.paidInCents += row.generated;
      if (status === "READY") person.payableInCents += row.generated;
      if (status === "AWAITING_COLLECTION") person.awaitingCollectionInCents += row.generated;
    }
    const history = [
      ...settlements.map(({ settlement, collaboratorName }) => ({ ...settlement, collaboratorName })),
      ...legacy.flatMap((row) => row.paidAt && row.amountCents ? [{
        ...row, amountCents: row.amountCents, paidAt: row.paidAt, periodEnd: row.periodStart,
        paymentMethod: null, notes: null, createdAt: row.paidAt,
      }] : []),
    ].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());
    for (const deduction of deductions) {
      const person = byId.get(deduction.collaboratorId);
      if (!person) continue;
      person.deductions.push(deduction);
      person.deductionsInCents += deduction.openAmountCents;
    }
    for (const application of applications) {
      byId.get(application.deduction.collaboratorId)?.appliedDeductions.push(application);
    }
    for (const person of professionals) {
      person.netPayableInCents = Math.max(0, person.payableInCents - person.deductionsInCents);
    }
    return { period, professionals, settlements: history };
  }

  settle(companyId: string, actorId: string, input: SettlementInput) {
    return db.transaction(async (tx) => {
      // The same company lock is used by receipts, refunds and single-appointment settlements.
      const { today, timezone } = await companyPolicy(tx, companyId, true);
      if (input.requestKey) {
        const [existing] = await tx.select({
          row: CommissionSettlementTable, paidOn: sql<string>`to_char(timezone(${timezone}, ${CommissionSettlementTable.paidAt}), 'YYYY-MM-DD')`,
        }).from(CommissionSettlementTable).where(and(eq(CommissionSettlementTable.companyId, companyId),
          eq(CommissionSettlementTable.requestKey, input.requestKey)));
        if (existing) {
          const { row } = existing;
          if (row.collaboratorId !== input.collaboratorId || row.periodStart !== input.periodStart ||
              row.periodEnd !== input.periodEnd || row.paymentMethod !== input.paymentMethod ||
              row.notes !== input.notes || existing.paidOn !== input.paidOn ||
              (input.expectedAmountCents !== null && row.amountCents !== input.expectedAmountCents)) {
            throw new CollectionsError("CONFLICT", "FINANCE_IDEMPOTENCY_CONFLICT");
          }
          return row;
        }
      }
      validatePaidDate(input.paidOn, today);
      const [professional] = await tx.select({ id: CollaboratorTable.id }).from(CollaboratorTable).where(and(
        eq(CollaboratorTable.companyId, companyId), eq(CollaboratorTable.id, input.collaboratorId),
      ));
      if (!professional) throw notFound();
      const rows = await commissionRows(tx, companyId, timezone, {
        from: input.periodStart, to: input.periodEnd, collaboratorId: input.collaboratorId,
      }, true);
      const eligible = rows.filter((row) => row.documentId &&
        getCommissionStatus("COMPLETED", row.generated, row.paidAt, row.collected, row.net ?? row.price) === "READY");
      const grossCents = eligible.reduce((sum, row) => sum + row.generated, 0);
      if (!grossCents) throw new CollectionsError("CONFLICT", "FINANCE_COMMISSION_NOT_READY");
      const deductions = await listCommissionDeductions(tx, companyId, {
        collaboratorId: input.collaboratorId, to: input.paidOn,
      }, true);
      let amountCents = grossCents;
      const applications = [];
      for (const deduction of deductions) {
        if (!amountCents) break;
        const applied = Math.min(amountCents, deduction.openAmountCents);
        amountCents -= applied;
        applications.push({ deduction, applied });
      }
      if (input.expectedAmountCents !== null && amountCents !== input.expectedAmountCents) {
        throw new CollectionsError("CONFLICT", "FINANCE_COMMISSION_TOTAL_CHANGED");
      }
      if (amountCents > 2147483647) throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
      const [settlement] = await tx.insert(CommissionSettlementTable).values({
        companyId, collaboratorId: input.collaboratorId, periodStart: input.periodStart, periodEnd: input.periodEnd,
        amountCents, paymentMethod: input.paymentMethod, paidAt: paymentInstant(input.paidOn, timezone),
        notes: input.notes, requestKey: input.requestKey, recordedBy: actorId,
      }).returning();
      for (let start = 0; start < eligible.length; start += 1000) {
        const ids = eligible.slice(start, start + 1000).map((row) => row.documentId!);
        const updated = await tx.update(FinancialDocumentTable).set({
          commissionPaidAt: settlement!.paidAt, commissionPaidBy: actorId, commissionSettlementId: settlement!.id,
        }).where(and(eq(FinancialDocumentTable.companyId, companyId), isNull(FinancialDocumentTable.commissionPaidAt),
          isNull(FinancialDocumentTable.commissionSettlementId), inArray(FinancialDocumentTable.id, ids))).returning({ id: FinancialDocumentTable.id });
        if (updated.length !== ids.length) throw new CollectionsError("CONFLICT", "FINANCE_COMMISSION_TOTAL_CHANGED");
      }
      for (const { deduction, applied } of applications) {
        await tx.insert(CommissionDeductionApplicationTable).values({
          companyId, deductionId: deduction.id, settlementId: settlement!.id, amountCents: applied,
        });
        if (applied === deduction.openAmountCents) {
          await tx.update(CommissionDeductionTable).set({ settlementId: settlement!.id })
            .where(and(eq(CommissionDeductionTable.companyId, companyId), eq(CommissionDeductionTable.id, deduction.id)));
        }
      }
      return settlement!;
    });
  }
}
