import { CollectionsError, type PaymentMethod } from "./collections.js";

export const EXPENSE_CATEGORIES = ["RENT", "UTILITIES", "MARKETING", "MAINTENANCE", "STOCK_PURCHASE", "OTHER"] as const;
export const COMMISSION_DEDUCTION_CATEGORIES = ["STOCK_PRODUCT", "ADVANCE", "OTHER"] as const;
export type CommissionDeductionCategory = (typeof COMMISSION_DEDUCTION_CATEGORIES)[number];

export interface CommissionDeductionDraft {
  collaboratorId: string;
  description: string;
  category: CommissionDeductionCategory;
  quantity: number;
  unitAmountCents?: number | null | undefined;
  amountCents?: number | undefined;
  deductedAt: string;
  notes: string | null;
  externalSourceType: string | null;
  externalSourceId: string | null;
  requestKey: string | null;
}

export function priceCommissionDeduction(draft: CommissionDeductionDraft) {
  const unitAmountCents = draft.unitAmountCents ?? null;
  const amountCents = unitAmountCents === null ? draft.amountCents ?? 0 : draft.quantity * unitAmountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 2147483647 ||
      (draft.amountCents !== undefined && draft.amountCents !== amountCents)) {
    throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
  }
  if (!!draft.externalSourceType !== !!draft.externalSourceId) {
    throw new CollectionsError("VALIDATION", "FINANCE_INVALID_DEDUCTION_SOURCE");
  }
  return { ...draft, unitAmountCents, amountCents };
}

export const EXPENSE_TYPES = ["FIXED", "VARIABLE"] as const;
export const EXPENSE_STATUSES = ["PENDING", "PAID", "OVERDUE"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseType = (typeof EXPENSE_TYPES)[number];
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export type Period = { from: string; to: string };
export type PaidInput = { paidOn: string; paymentMethod: PaymentMethod };

export interface ExpenseInput {
  description: string;
  category: ExpenseCategory;
  expenseType: ExpenseType;
  amountCents: number;
  quantity: number;
  unitAmountCents: number | null;
  dueDate: string;
  isRecurring: boolean;
  notes: string | null;
  externalSourceType: string | null;
  externalSourceId: string | null;
  requestKey: string | null;
}

export type ExpenseDraft = Omit<ExpenseInput, "amountCents" | "quantity" | "unitAmountCents"> & {
  amountCents?: number | undefined;
  quantity?: number | undefined;
  unitAmountCents?: number | null | undefined;
};

export function priceExpense(draft: ExpenseDraft): ExpenseInput {
  const quantity = draft.quantity ?? 1;
  const unitAmountCents = draft.unitAmountCents ?? null;
  const amountCents = unitAmountCents === null ? draft.amountCents ?? 0 : quantity * unitAmountCents;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 2147483647 ||
      (unitAmountCents === null ? quantity !== 1 : !Number.isSafeInteger(unitAmountCents) || unitAmountCents < 1) ||
      !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 2147483647) {
    throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
  }
  return { ...draft, quantity, unitAmountCents, amountCents };
}

export type ExpensePayment = { paidOn: string; paymentMethod: PaymentMethod } | null;
export type ExpenseEdit = Partial<Pick<ExpenseInput, "description" | "category" | "expenseType" |
  "amountCents" | "quantity" | "unitAmountCents" | "dueDate" | "isRecurring" | "notes">> & {
  status?: "PENDING" | "PAID" | undefined;
  paidOn?: string | null | undefined;
  paymentMethod?: PaymentMethod | null | undefined;
};

export function expensePayment(input: ExpenseEdit, prior: ExpensePayment = null): ExpensePayment {
  if (input.status === "PENDING") {
    if (input.paidOn || input.paymentMethod) throw new CollectionsError("VALIDATION", "FINANCE_EXPENSE_PAYMENT_REQUIRED");
    return null;
  }
  const paidOn = input.paidOn === undefined ? prior?.paidOn : input.paidOn;
  const paymentMethod = input.paymentMethod === undefined ? prior?.paymentMethod : input.paymentMethod;
  if (paidOn && paymentMethod) return { paidOn, paymentMethod };
  if (input.status === "PAID" || paidOn || paymentMethod) {
    throw new CollectionsError("VALIDATION", "FINANCE_EXPENSE_PAYMENT_REQUIRED");
  }
  return null;
}

export interface Expense extends ExpenseInput {
  id: string;
  paidAt: Date | null;
  paidOn: string | null;
  paymentMethod: PaymentMethod | null;
  status: ExpenseStatus;
  createdAt: Date;
}

export interface CommissionFilter extends Period {
  collaboratorId?: string | undefined;
}

export interface SettlementInput extends PaidInput {
  collaboratorId: string;
  periodStart: string;
  periodEnd: string;
  expectedAmountCents: number | null;
  requestKey: string | null;
  notes: string | null;
}

export interface Settlement {
  id: string;
  collaboratorId: string;
  periodStart: string;
  periodEnd: string;
  amountCents: number;
  paymentMethod: PaymentMethod | null;
  paidAt: Date;
  notes: string | null;
  createdAt: Date;
}

export function expenseStatus(dueDate: string, paidAt: Date | null, today: string): ExpenseStatus {
  if (paidAt) return "PAID";
  return dueDate < today ? "OVERDUE" : "PENDING";
}
