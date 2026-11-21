import { and, asc, eq, getTableColumns, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { OutflowFilters } from "../../../application/outflows.use-cases.js";
import { CommissionDeductionApplicationTable, CommissionDeductionTable } from "../schema/outflows-schema.js";
import type { FinanceQuery } from "./outflow-projections.js";

const deduction = CommissionDeductionTable;
const application = CommissionDeductionApplicationTable;
const openAmountCents = sql<number>`${deduction.amountCents} - coalesce((${sql`
  select sum(${application.amountCents}) from ${application}
  where ${application.companyId} = ${deduction.companyId} and ${application.deductionId} = ${deduction.id}
`}), 0)`.mapWith(Number);
const projection = { ...getTableColumns(deduction), openAmountCents };

export function listCommissionDeductions(query: FinanceQuery, companyId: string, filters: OutflowFilters,
  openOnly = false, scope?: SQL) {
  return query.select(projection).from(deduction).where(and(
    eq(deduction.companyId, companyId), scope,
    filters.collaboratorId ? eq(deduction.collaboratorId, filters.collaboratorId) : undefined,
    filters.from ? gte(deduction.deductedAt, filters.from) : undefined,
    filters.to ? lte(deduction.deductedAt, filters.to) : undefined,
    openOnly ? isNull(deduction.settlementId) : undefined,
  )).orderBy(asc(deduction.deductedAt), asc(deduction.createdAt), asc(deduction.id));
}

export function listDeductionApplications(query: FinanceQuery, companyId: string, settlementIds: string[]) {
  if (!settlementIds.length) return Promise.resolve([]);
  return query.select({ deduction: projection, amountCents: application.amountCents, settlementId: application.settlementId })
    .from(application).innerJoin(deduction, and(eq(deduction.companyId, application.companyId),
      eq(deduction.id, application.deductionId)))
    .where(and(eq(application.companyId, companyId), inArray(application.settlementId, settlementIds)))
    .orderBy(asc(deduction.deductedAt), asc(deduction.createdAt), asc(deduction.id));
}
