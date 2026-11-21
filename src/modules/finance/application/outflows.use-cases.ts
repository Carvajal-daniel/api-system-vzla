import type { CommissionDeductionTable } from "../infra/database/schema/outflows-schema.js";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { CollectionsError } from "../domain/collections.js";
import { expensePayment, priceCommissionDeduction, priceExpense, type ExpenseEdit, type ExpensePayment, type CommissionDeductionDraft, type CommissionFilter, type Expense, type ExpenseDraft, type ExpenseInput, type ExpenseStatus, type PaidInput, type Settlement, type SettlementInput } from "../domain/outflows.js";

export type OutflowFilters = { from?: string | undefined; to?: string | undefined; collaboratorId?: string | undefined };
export type ExpenseFilters = OutflowFilters & { status?: ExpenseStatus | undefined };

export type CommissionDeduction = typeof CommissionDeductionTable.$inferSelect & { openAmountCents: number };
export type CommissionDeductionInput = ReturnType<typeof priceCommissionDeduction>;

export interface CommissionReport {
  period: CommissionFilter;
  professionals: {
    collaboratorId: string;
    name: string;
    forecastInCents: number;
    awaitingCollectionInCents: number;
    payableInCents: number;
    paidInCents: number;
    deductionsInCents: number;
    netPayableInCents: number;
    deductions: CommissionDeduction[];
    appliedDeductions: { deduction: CommissionDeduction; amountCents: number; settlementId: string }[];
  }[];
  settlements: (Settlement & { collaboratorName: string })[];
}

export interface OutflowsRepository {
  listExpenses(companyId: string, filters: ExpenseFilters): Promise<Expense[]>;
  createExpense(companyId: string, input: ExpenseInput): Promise<Expense>;
  editExpense(companyId: string, id: string, input: ExpenseEdit): Promise<Expense>;
  importExpenses(companyId: string, key: string, items: { expense: ExpenseInput; payment: ExpensePayment }[]): Promise<{ imported: number }>;
  payExpense(companyId: string, id: string, input: PaidInput): Promise<Expense>;
  deleteExpense(companyId: string, id: string): Promise<void>;
  commissions(companyId: string, filters: OutflowFilters): Promise<CommissionReport>;
  listCommissionDeductions(companyId: string, filters: OutflowFilters): Promise<CommissionDeduction[]>;
  createCommissionDeduction(companyId: string, input: CommissionDeductionInput): Promise<CommissionDeduction>;
  deleteCommissionDeduction(companyId: string, id: string): Promise<void>;
  settle(companyId: string, actorId: string, input: SettlementInput): Promise<Settlement>;
}

function owner(actor: ActorContext): asserts actor is Extract<ActorContext, { role: "OWNER" }> {
  if (actor.role !== "OWNER") throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
}

export function validatePeriod(from?: string, to?: string) {
  if (from && to && from > to) throw new CollectionsError("VALIDATION", "FINANCE_INVALID_PERIOD");
}

export class ManageExpenses {
  constructor(private readonly repository: OutflowsRepository) {}

  list(actor: ActorContext, filters: ExpenseFilters) {
    owner(actor);
    validatePeriod(filters.from, filters.to);
    if (filters.collaboratorId) return Promise.resolve([]);
    return this.repository.listExpenses(actor.companyId, filters);
  }

  create(actor: ActorContext, input: ExpenseDraft) {
    owner(actor);
    if (!!input.externalSourceType !== !!input.externalSourceId) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_EXPENSE_SOURCE");
    }
    return this.repository.createExpense(actor.companyId, priceExpense(input));
  }

  edit(actor: ActorContext, id: string, input: ExpenseEdit) {
    owner(actor);
    return this.repository.editExpense(actor.companyId, id, input);
  }

  import(actor: ActorContext, key: string, rows: (ExpenseDraft & Pick<ExpenseEdit, "status" | "paidOn" | "paymentMethod">)[]) {
    owner(actor);
    const items = rows.map(({ status, paidOn, paymentMethod, ...draft }) => ({
      expense: priceExpense(draft), payment: expensePayment({ status, paidOn, paymentMethod }),
    }));
    return this.repository.importExpenses(actor.companyId, key, items);
  }

  pay(actor: ActorContext, id: string, input: PaidInput) {
    owner(actor);
    return this.repository.payExpense(actor.companyId, id, input);
  }

  remove(actor: ActorContext, id: string) {
    owner(actor);
    return this.repository.deleteExpense(actor.companyId, id);
  }
}

export class ManageCommissionSettlements {
  constructor(private readonly repository: OutflowsRepository) {}

  list(actor: ActorContext, filters: OutflowFilters) {
    owner(actor);
    validatePeriod(filters.from, filters.to);
    return this.repository.commissions(actor.companyId, filters);
  }

  listDeductions(actor: ActorContext, filters: OutflowFilters) {
    owner(actor);
    validatePeriod(filters.from, filters.to);
    return this.repository.listCommissionDeductions(actor.companyId, filters);
  }

  createDeduction(actor: ActorContext, draft: CommissionDeductionDraft) {
    owner(actor);
    return this.repository.createCommissionDeduction(actor.companyId, priceCommissionDeduction(draft));
  }

  deleteDeduction(actor: ActorContext, id: string) {
    owner(actor);
    return this.repository.deleteCommissionDeduction(actor.companyId, id);
  }

  record(actor: ActorContext, input: SettlementInput) {
    owner(actor);
    validatePeriod(input.periodStart, input.periodEnd);
    return this.repository.settle(actor.companyId, actor.userId, input);
  }
}
