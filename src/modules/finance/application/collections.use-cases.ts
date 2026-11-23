import type { ActorContext } from "../../../shared/auth/actor-context.js";
import {
  appointmentBalance, CollectionsError, type PaymentMethod, type Receipt, type Receivable,
} from "../domain/collections.js";

export type ReceiptWrite = Omit<Receipt, "id" | "recordedAt">;

export interface AppointmentCollections {
  receivable: Receivable;
  receipts: Receipt[];
  openedOn: string;
  today: string;
  getRequest(key: string): Promise<(Receipt & { appointmentId: string })[]>;
  addReceipts(items: ReceiptWrite[]): Promise<Receipt[]>;
  markCommissionPaid(actorId: string): Promise<Date>;
}

export interface CollectionsRepository {
  detail(companyId: string, appointmentId: string): Promise<{ receivable: Receivable; receipts: Receipt[] }>;
  transact<T>(
    companyId: string,
    target: { appointmentId: string } | { receiptId: string },
    work: (collections: AppointmentCollections) => Promise<T>,
  ): Promise<T>;
}

export const collectionErrors = {
  permission: "FINANCE_OWNER_REQUIRED",
  missing: "FINANCE_RECORD_NOT_FOUND",
  appointmentStatus: "FINANCE_APPOINTMENT_NOT_COLLECTIBLE",
  alreadyPaid: "FINANCE_APPOINTMENT_ALREADY_PAID",
  amount: "FINANCE_AMOUNT_EXCEEDS_BALANCE",
  date: "FINANCE_INVALID_EFFECTIVE_DATE",
  idempotency: "FINANCE_IDEMPOTENCY_CONFLICT",
  reason: "FINANCE_REFUND_REASON_REQUIRED",
  settlement: "FINANCE_COMMISSION_NOT_READY",
} as const;

function owner(actor: ActorContext): asserts actor is Extract<ActorContext, { role: "OWNER" }> {
  if (actor.role !== "OWNER") throw new CollectionsError("FORBIDDEN", collectionErrors.permission);
}

function assertDate(effectiveOn: string, context: AppointmentCollections) {
  if (effectiveOn < context.openedOn || effectiveOn > context.today) {
    throw new CollectionsError("VALIDATION", collectionErrors.date);
  }
}

async function writeOnce(context: AppointmentCollections, items: ReceiptWrite[]) {
  const first = items[0]!;
  const previous = await context.getRequest(first.requestKey);
  if (previous.length) {
    const same = previous.length === items.length && previous.every((row, index) => {
      const item = items[index];
      return item && row.appointmentId === context.receivable.appointmentId &&
        row.amountInCents === item.amountInCents && row.method === item.method &&
        row.effectiveOn === item.effectiveOn && row.reversesReceiptId === item.reversesReceiptId &&
        row.reason === item.reason;
    });
    if (!same) throw new CollectionsError("CONFLICT", collectionErrors.idempotency);
    return previous.map(({ appointmentId: _appointmentId, ...receipt }) => receipt);
  }
  return null;
}

export class GetAppointmentCollections {
  constructor(private readonly repository: CollectionsRepository) {}

  async execute(actor: ActorContext, appointmentId: string) {
    owner(actor);
    const result = await this.repository.detail(actor.companyId, appointmentId);
    return appointmentBalance(result.receivable, result.receipts);
  }
}

export class RecordAppointmentReceipts {
  constructor(private readonly repository: CollectionsRepository) {}

  async execute(actor: ActorContext, input: {
    appointmentId: string;
    effectiveOn: string;
    requestKey: string;
    payments: { method: PaymentMethod; amountInCents: number }[];
  }) {
    owner(actor);
    return this.repository.transact(actor.companyId, { appointmentId: input.appointmentId }, async (context) => {
      if (input.payments.length < 1 || input.payments.length > 2) {
        throw new CollectionsError("VALIDATION", collectionErrors.amount);
      }
      const items = input.payments.map((item, position) => ({
        ...item,
        position,
        effectiveOn: input.effectiveOn,
        requestKey: input.requestKey,
        recordedBy: actor.userId,
        reversesReceiptId: null,
        reason: null,
      }));
      const previous = await writeOnce(context, items);
      if (previous) return previous;
      assertDate(input.effectiveOn, context);
      const balance = appointmentBalance(context.receivable, context.receipts);
      if (balance.status !== "CONFIRMED" && balance.status !== "COMPLETED") {
        throw new CollectionsError("CONFLICT", collectionErrors.appointmentStatus);
      }
      // Bloqueia cobrança duplicada em atendimento já quitado integralmente
      if (balance.openInCents === 0) {
        throw new CollectionsError("CONFLICT", collectionErrors.alreadyPaid);
      }
      const amount = items.reduce((total, item) => total + item.amountInCents, 0);
      if (items.some((item) => !Number.isSafeInteger(item.amountInCents) || item.amountInCents <= 0) ||
          new Set(items.map((item) => item.method)).size !== items.length ||
          amount > balance.openInCents) {
        throw new CollectionsError("VALIDATION", collectionErrors.amount);
      }
      return context.addReceipts(items);
    });
  }
}

export class RefundAppointmentReceipt {
  constructor(private readonly repository: CollectionsRepository) {}

  async execute(actor: ActorContext, receiptId: string, input: {
    amountInCents: number;
    effectiveOn: string;
    requestKey: string;
    reason: string;
  }) {
    owner(actor);
    const reason = input.reason.trim();
    if (!reason || reason.length > 500) throw new CollectionsError("VALIDATION", collectionErrors.reason);
    return this.repository.transact(actor.companyId, { receiptId }, async (context) => {
      const balance = appointmentBalance(context.receivable, context.receipts);
      const original = balance.receipts.find((item) => item.id === receiptId && !item.reversesReceiptId);
      if (!original) throw new CollectionsError("NOT_FOUND", collectionErrors.missing);
      const item = {
        ...input,
        reason,
        method: original.method,
        recordedBy: actor.userId,
        position: 0,
        reversesReceiptId: receiptId,
      };
      const previous = await writeOnce(context, [item]);
      if (previous) return previous;
      assertDate(input.effectiveOn, context);
      if (input.effectiveOn < original.effectiveOn) throw new CollectionsError("VALIDATION", collectionErrors.date);
      if (!Number.isSafeInteger(input.amountInCents) || input.amountInCents <= 0 ||
          input.amountInCents > original.refundableInCents) {
        throw new CollectionsError("VALIDATION", collectionErrors.amount);
      }
      return context.addReceipts([item]);
    });
  }
}

export class SettleAppointmentCommission {
  constructor(private readonly repository: CollectionsRepository) {}

  async execute(actor: ActorContext, appointmentId: string) {
    owner(actor);
    return this.repository.transact(actor.companyId, { appointmentId }, async (context) => {
      const balance = appointmentBalance(context.receivable, context.receipts);
      if (balance.commissionStatus === "PAID") return balance;
      if (balance.commissionStatus !== "READY") {
        throw new CollectionsError("CONFLICT", collectionErrors.settlement);
      }
      const commissionPaidAt = await context.markCommissionPaid(actor.userId);
      return appointmentBalance({ ...context.receivable, commissionPaidAt }, context.receipts);
    });
  }
}
