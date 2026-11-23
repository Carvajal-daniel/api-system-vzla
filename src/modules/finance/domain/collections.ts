import { DomainError } from "../../../shared/Errors/domain-error.js";
import type { AppointmentStatusValue } from "../../appointments/domain/value-objects/appointment-status.vo.js";

export const PAYMENT_METHODS = ["CASH", "PIX", "DEBIT_CARD", "CREDIT_CARD", "TRANSFER", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type Currency = "BRL" | "USD" | "VES";

export class CollectionsError extends DomainError {
  constructor(code: "FORBIDDEN" | "UNAUTHORIZED" | "VALIDATION" | "NOT_FOUND" | "CONFLICT", message: string) {
    super(message, code);
  }
}

export interface Receivable {
  appointmentId: string;
  status: AppointmentStatusValue;
  clientName: string;
  serviceName: string;
  currency: Currency;
  netInCents: number;
  historical: boolean;
  generatedCommissionInCents: number | null;
  commissionPaidAt: Date | null;
}

export interface Receipt {
  id: string;
  amountInCents: number;
  method: PaymentMethod;
  effectiveOn: string;
  recordedAt: Date;
  recordedBy: string;
  requestKey: string;
  position: number;
  reversesReceiptId: string | null;
  reason: string | null;
}

export function getCommissionStatus(status: AppointmentStatusValue, amount: number | null, paidAt: Date | null,
  collected: number, net: number) {
  if (status !== "COMPLETED" || !amount) return "NONE";
  if (paidAt) return "PAID";
  return collected < net ? "AWAITING_COLLECTION" : "READY";
}

export function appointmentBalance(receivable: Receivable, receipts: Receipt[]) {
  const reversedAmounts = new Map<string, number>();
  let collectedInCents = 0;
  for (const receipt of receipts) {
    const original = receipt.reversesReceiptId;
    if (original) {
      reversedAmounts.set(original, (reversedAmounts.get(original) ?? 0) + receipt.amountInCents);
      collectedInCents -= receipt.amountInCents;
    } else {
      collectedInCents += receipt.amountInCents;
    }
  }
  const collectible = receivable.status === "CONFIRMED" || receivable.status === "COMPLETED";
  const historical = receivable.historical && receipts.length === 0;
  const openInCents = collectible ? Math.max(0, receivable.netInCents - collectedInCents) : 0;
  const commissionStatus = getCommissionStatus(receivable.status, receivable.generatedCommissionInCents,
    receivable.commissionPaidAt, collectedInCents, receivable.netInCents);
  return {
    ...receivable,
    collectedInCents,
    openInCents,
    historical,
    commissionStatus,
    retainedInCents: collectible ? 0 : collectedInCents,
    canCollect: collectible && openInCents > 0,
    receipts: receipts.map((receipt) => ({
      ...receipt,
      refundableInCents: receipt.reversesReceiptId ? 0 : receipt.amountInCents - (reversedAmounts.get(receipt.id) ?? 0),
    })),
  };
}
