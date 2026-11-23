import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import {
  GetAppointmentCollections, RecordAppointmentReceipts, RefundAppointmentReceipt,
  SettleAppointmentCommission, collectionErrors, type CollectionsRepository, type ReceiptWrite,
} from "../application/collections.use-cases.js";
import type { Receipt, Receivable } from "../domain/collections.js";

const owner = { role: "OWNER", userId: "owner-a", companyId: "tenant-a" } as const;
const employee: ActorContext = { role: "COLLABORATOR", collaboratorId: "pro-a", companyId: "tenant-a" };
const appointmentId = "appointment-a";
const effectiveOn = "2026-11-21";

function fixture() {
  const receivable: Receivable = {
    appointmentId, status: "CONFIRMED", clientName: "Client", serviceName: "Cut",
    currency: "BRL", netInCents: 10000, historical: false,
    generatedCommissionInCents: null, commissionPaidAt: null,
  };
  const receipts: Receipt[] = [];
  async function addReceipts(items: ReceiptWrite[]) {
    const rows = items.map((item, index) => ({
      ...item, id: "receipt-" + (receipts.length + index), recordedAt: new Date(effectiveOn),
    }));
    receipts.push(...rows);
    return rows;
  }
  const repository: CollectionsRepository = {
    async detail() { return { receivable, receipts }; },
    async transact(_companyId, _target, work) {
      return work({
        receivable, receipts, today: effectiveOn, openedOn: effectiveOn, addReceipts,
        async getRequest(key) {
          return receipts.filter((receipt) => receipt.requestKey === key).map((receipt) => ({ ...receipt, appointmentId }));
        },
        async markCommissionPaid() {
          receivable.commissionPaidAt = new Date(effectiveOn);
          return receivable.commissionPaidAt;
        },
      });
    },
  };
  return {
    receivable, receipts,
    record: new RecordAppointmentReceipts(repository),
    refund: new RefundAppointmentReceipt(repository),
    detail: new GetAppointmentCollections(repository),
    settle: new SettleAppointmentCommission(repository),
  };
}

describe("Appointment collections", () => {
  it("records a split advance once, refuses changed replay and prevents overpayment", async () => {
    const { record, detail, receipts } = fixture();
    const request = { appointmentId, effectiveOn, requestKey: "advance", payments: [
      { method: "CASH" as const, amountInCents: 2000 },
      { method: "PIX" as const, amountInCents: 3000 },
    ] };
    const initial = await record.execute(owner, request);
    const replay = await record.execute(owner, request);
    expect(replay).toEqual(initial);
    expect(receipts).toHaveLength(2);
    await expect(record.execute(owner, { ...request, payments: [request.payments[0]!] }))
      .rejects.toThrow(collectionErrors.idempotency);
    await expect(record.execute(owner, {
      ...request, requestKey: "overpay", payments: [{ method: "CASH", amountInCents: 5001 }],
    })).rejects.toThrow(collectionErrors.amount);
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ collectedInCents: 5000, openInCents: 5000 });
  });

  it("retains an advance on no-show and allows only justified refunds up to the original amount", async () => {
    const { record, refund, detail, receivable } = fixture();
    const [original] = await record.execute(owner, { appointmentId, effectiveOn, requestKey: "advance",
      payments: [{ method: "TRANSFER", amountInCents: 2000 }] });
    receivable.status = "NO_SHOW";
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ retainedInCents: 2000, canCollect: false });
    await expect(record.execute(owner, { appointmentId, effectiveOn, requestKey: "extra",
      payments: [{ method: "CASH", amountInCents: 1 }] })).rejects.toThrow(collectionErrors.appointmentStatus);
    const request = { amountInCents: 1500, effectiveOn, requestKey: "refund", reason: "  Customer cancellation  " };
    await expect(refund.execute(owner, original!.id, { ...request, reason: " " })).rejects.toThrow(collectionErrors.reason);
    await refund.execute(owner, original!.id, request);
    await refund.execute(owner, original!.id, request);
    const result = await detail.execute(owner, appointmentId);
    expect(result).toMatchObject({ retainedInCents: 500, openInCents: 0 });
    expect(result.receipts[1]).toMatchObject({ reason: "Customer cancellation", method: "TRANSFER", recordedBy: owner.userId });
    await expect(refund.execute(owner, original!.id, { ...request, requestKey: "more-refund" }))
      .rejects.toThrow(collectionErrors.amount);
  });

  it("keeps a fully prepaid booking ineligible until completion", async () => {
    const { record, detail, settle, receivable } = fixture();
    await record.execute(owner, { appointmentId, effectiveOn, requestKey: "full-advance",
      payments: [{ method: "PIX", amountInCents: 10000 }] });
    receivable.generatedCommissionInCents = 4000;
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      receivable.status = status;
      expect(await detail.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "NONE" });
      await expect(settle.execute(owner, appointmentId)).rejects.toThrow(collectionErrors.settlement);
    }
    receivable.status = "COMPLETED";
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "READY" });
  });

  it("requires full collection to settle generated commissions and keeps a posted settlement after refund", async () => {
    const { record, refund, detail, settle, receivable } = fixture();
    receivable.status = "COMPLETED";
    receivable.generatedCommissionInCents = 4000;
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "AWAITING_COLLECTION" });
    await expect(settle.execute(owner, appointmentId)).rejects.toThrow(collectionErrors.settlement);
    const [movement] = await record.execute(owner, { appointmentId, effectiveOn, requestKey: "settled-service",
      payments: [{ method: "CREDIT_CARD", amountInCents: 10000 }] });
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "READY" });
    await expect(settle.execute(employee, appointmentId)).rejects.toThrow(collectionErrors.permission);
    expect(await settle.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "PAID" });
    await refund.execute(owner, movement!.id, { amountInCents: 1000, effectiveOn, requestKey: "refund",
      reason: "Correction after payment" });
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ commissionStatus: "PAID", openInCents: 1000 });
  });

  it("keeps a pre-cutoff completion identifiable and rejects effective dates outside the tracking window", async () => {
    const { receivable, detail, record } = fixture();
    receivable.status = "COMPLETED";
    receivable.historical = true;
    receivable.generatedCommissionInCents = 4000;
    expect(await detail.execute(owner, appointmentId)).toMatchObject({ historical: true, commissionStatus: "AWAITING_COLLECTION" });
    const request = { appointmentId, requestKey: "receipt", effectiveOn: "2026-11-20",
      payments: [{ method: "OTHER" as const, amountInCents: 50 }] };
    await expect(record.execute(owner, request)).rejects.toThrow(collectionErrors.date);
    await expect(record.execute(employee, { ...request, effectiveOn })).rejects.toThrow(collectionErrors.permission);
  });

  it("blocks duplicate collection on an already fully paid appointment with 409 CONFLICT", async () => {
    const { record } = fixture();
    await record.execute(owner, {
      appointmentId,
      effectiveOn,
      requestKey: "full-payment",
      payments: [{ method: "PIX", amountInCents: 10000 }],
    });

    await expect(
      record.execute(owner, {
        appointmentId,
        effectiveOn,
        requestKey: "duplicate-payment",
        payments: [{ method: "CASH", amountInCents: 1000 }],
      }),
    ).rejects.toThrow(collectionErrors.alreadyPaid);
  });
});
