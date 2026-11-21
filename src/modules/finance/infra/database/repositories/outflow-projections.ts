import { and, asc, eq, getTableColumns, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import type { ExpenseFilters } from "../../../application/outflows.use-cases.js";
import { EXPENSE_CATEGORIES, expenseStatus, type Period } from "../../../domain/outflows.js";
import { FinancialDocumentTable } from "../schema/collections-schema.js";
import { CommissionSettlementTable, ExpenseTable } from "../schema/outflows-schema.js";

export type FinanceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type FinanceQuery = typeof db | FinanceTransaction;

export function localDay(timezone: string, instant: typeof ExpenseTable.paidAt | typeof AppointmentTable.startsAt | typeof FinancialDocumentTable.commissionPaidAt) {
  return sql`timezone(${timezone}, ${instant})::date`;
}

export function paymentInstant(paidOn: string, timezone: string) {
  return sql`case when ${paidOn}::date = (now() at time zone ${timezone})::date then now()
    else (${paidOn}::date + time '12:00') at time zone ${timezone} end`;
}

export function expenseList(query: FinanceQuery, companyId: string, timezone: string, today: string, filters: ExpenseFilters) {
  const paid = localDay(timezone, ExpenseTable.paidAt);
  const compareDate = (date: string) => sql`${date}::date`;
  const dueInPeriod = and(
    filters.from ? gte(ExpenseTable.dueDate, filters.from) : undefined,
    filters.to ? lte(ExpenseTable.dueDate, filters.to) : undefined,
  );
  const paidInPeriod = and(
    filters.from ? gte(paid, compareDate(filters.from)) : undefined,
    filters.to ? lte(paid, compareDate(filters.to)) : undefined,
  );
  const status = filters.status === "PAID" ? eq(ExpenseTable.status, "PAID")
    : filters.status === "PENDING" ? and(isNull(ExpenseTable.paidAt), gte(ExpenseTable.dueDate, today))
      : filters.status === "OVERDUE" ? and(isNull(ExpenseTable.paidAt), lt(ExpenseTable.dueDate, today)) : undefined;
  return query.select({ ...getTableColumns(ExpenseTable), paidOn: sql<string | null>`to_char(${paid}, 'YYYY-MM-DD')` })
    .from(ExpenseTable).where(and(eq(ExpenseTable.companyId, companyId), or(dueInPeriod, paidInPeriod), status))
    .orderBy(asc(ExpenseTable.dueDate), asc(ExpenseTable.id))
    .then((rows) => rows.map((row) => ({ ...row, status: expenseStatus(row.dueDate, row.paidAt, today) })));
}

export async function readOutflowSummary(companyId: string, timezone: string, today: string, period: Period, previousFrom: string, collaboratorId?: string) {
  const companyView = !collaboratorId;
  const commissionDay = localDay(timezone, FinancialDocumentTable.commissionPaidAt);
  const [rows, [alerts], individualCommissionCash, batchCommissionCash] = await Promise.all([
    companyView ? expenseList(db, companyId, timezone, today, { from: previousFrom, to: period.to }) : [],
    companyView ? db.select({
      overdueCount: sql<number>`count(*) filter (where ${ExpenseTable.dueDate} < ${today}::date)`.mapWith(Number),
      dueSoonCount: sql<number>`count(*) filter (where ${ExpenseTable.dueDate} between ${today}::date and ${today}::date + 7)`.mapWith(Number),
    }).from(ExpenseTable).where(and(
      eq(ExpenseTable.companyId, companyId), isNull(ExpenseTable.paidAt),
      lte(ExpenseTable.dueDate, sql`${today}::date + 7`),
    )) : [],
    db.select({
      date: sql<string>`to_char(${commissionDay}, 'YYYY-MM-DD')`,
      amountCents: sql<number>`sum(${FinancialDocumentTable.generatedCommissionInCents})`.mapWith(Number),
    }).from(FinancialDocumentTable).innerJoin(AppointmentTable, and(
      eq(AppointmentTable.id, FinancialDocumentTable.appointmentId),
      eq(AppointmentTable.companyId, FinancialDocumentTable.companyId),
    )).where(and(
      eq(FinancialDocumentTable.companyId, companyId), eq(AppointmentTable.status, "COMPLETED"),
      isNull(FinancialDocumentTable.commissionSettlementId), gte(commissionDay, sql`${previousFrom}::date`),
      lte(commissionDay, sql`${period.to}::date`),
      collaboratorId ? eq(AppointmentTable.collaboratorId, collaboratorId) : undefined,
    )).groupBy(sql`1`),
    db.select({
      date: sql<string>`to_char(timezone(${timezone}, ${CommissionSettlementTable.paidAt}), 'YYYY-MM-DD')`,
      amountCents: sql<number>`sum(${CommissionSettlementTable.amountCents})`.mapWith(Number),
    }).from(CommissionSettlementTable).where(and(
      eq(CommissionSettlementTable.companyId, companyId),
      sql`timezone(${timezone}, ${CommissionSettlementTable.paidAt})::date between ${previousFrom}::date and ${period.to}::date`,
      collaboratorId ? eq(CommissionSettlementTable.collaboratorId, collaboratorId) : undefined,
    )).groupBy(sql`1`),
  ]);

  const inPeriod = (day: string) => day >= period.from && day <= period.to;
  const inPrevious = (day: string) => day >= previousFrom && day < period.from;
  const byCategory = EXPENSE_CATEGORIES.map((category) => ({ category, amountCents: 0, cashPaidCents: 0 }));
  const categoryTotals = new Map(byCategory.map((item) => [item.category, item]));
  const cashDays = new Map<string, { date: string; expensesCents: number; commissionsCents: number }>();
  const dateEntry = (date: string) => {
    const entry = cashDays.get(date) ?? { date, expensesCents: 0, commissionsCents: 0 };
    cashDays.set(date, entry);
    return entry;
  };
  let totalCents = 0;
  let previousTotalCents = 0;
  let paidCents = 0;
  let pendingCents = 0;
  let overdueCents = 0;
  let cashPaidCents = 0;
  let previousCashPaidCents = 0;
  let cashCommissionsCents = 0;
  let previousCashCommissionsCents = 0;
  const items = [];
  for (const row of rows) {
    if (row.paidOn && inPeriod(row.paidOn)) {
      cashPaidCents += row.amountCents;
      categoryTotals.get(row.category)!.cashPaidCents += row.amountCents;
      dateEntry(row.paidOn).expensesCents += row.amountCents;
    }
    if (row.paidOn && inPrevious(row.paidOn)) previousCashPaidCents += row.amountCents;
    if (inPrevious(row.dueDate) || (row.paidOn && inPrevious(row.paidOn))) previousTotalCents += row.amountCents;
    if (!inPeriod(row.dueDate) && !(row.paidOn && inPeriod(row.paidOn))) continue;
    items.push(row);
    totalCents += row.amountCents;
    const bucket = categoryTotals.get(row.category)!;
    bucket.amountCents += row.amountCents;
    if (row.status === "PAID") paidCents += row.amountCents;
    if (row.status === "PENDING") pendingCents += row.amountCents;
    if (row.status === "OVERDUE") overdueCents += row.amountCents;
  }
  for (const row of [...individualCommissionCash, ...batchCommissionCash]) {
    if (inPrevious(row.date)) {
      previousCashCommissionsCents += row.amountCents;
    } else {
      cashCommissionsCents += row.amountCents;
      dateEntry(row.date).commissionsCents += row.amountCents;
    }
  }
  return {
    expenses: companyView ? {
      totalCents, previousTotalCents, paidCents, pendingCents, overdueCents, cashPaidCents,
      previousCashPaidCents, byCategory, items,
    } : null,
    cashDays: [...cashDays.values()],
    cashCommissionsCents,
    previousCashCommissionsCents,
    alerts: { overdueCount: alerts?.overdueCount ?? 0, dueSoonCount: alerts?.dueSoonCount ?? 0 },
  };
}
