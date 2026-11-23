import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import {
  ManageCommissionSettlements,
  type CollaboratorCommissionDetail,
  type OutflowsRepository,
} from "../application/outflows.use-cases.js";
import { CollectionsError } from "../domain/collections.js";

const ownerActor: ActorContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-000000000010",
  role: "OWNER",
};

const collabActor: ActorContext = {
  collaboratorId: "00000000-0000-4000-8000-000000000002",
  companyId: "00000000-0000-4000-8000-000000000010",
  role: "COLLABORATOR",
};

describe("Commission detail & settlement use cases", () => {
  it("returns detailed pending items (services + products), deductions and settled history", async () => {
    const detailFixture: CollaboratorCommissionDetail = {
      period: { from: "2026-11-01", to: "2026-11-30", collaboratorId: "00000000-0000-4000-8000-000000000002" },
      collaborator: { id: "00000000-0000-4000-8000-000000000002", name: "João Barbeiro" },
      summary: {
        grossPendingCents: 3800,
        deductionsCents: 1000,
        alreadyPaidCents: 5000,
        netPayableCents: 2800,
      },
      pendingItems: [
        {
          id: "item-1",
          source: "APPOINTMENT",
          itemType: "SERVICE",
          date: "2026-11-20",
          clientName: "Lucas",
          description: "Corte Degradê",
          baseAmountCents: 6000,
          commissionPercentage: 50,
          commissionCents: 3000,
        },
        {
          id: "item-2",
          source: "ORDER",
          itemType: "PRODUCT",
          date: "2026-11-21",
          clientName: "Venda Avulsa",
          description: "Óleo para Barba",
          baseAmountCents: 8000,
          commissionPercentage: 10,
          commissionCents: 800,
        },
      ],
      deductions: [],
      settledHistory: [
        {
          id: "settle-1",
          paidAt: "2026-11-15T18:00:00.000Z",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-15",
          amountCents: 5000,
          paymentMethod: "PIX",
          notes: "Quinzena 1",
          items: [],
        },
      ],
    };

    const repository = {
      collaboratorCommissionDetail: vi.fn().mockResolvedValue(detailFixture),
      settle: vi
        .fn()
        .mockResolvedValueOnce({
          id: "settle-2",
          collaboratorId: "00000000-0000-4000-8000-000000000002",
          amountCents: 2800,
          paymentMethod: "PIX",
        })
        .mockRejectedValueOnce(new CollectionsError("CONFLICT", "FINANCE_COMMISSION_NOT_READY")),
    } as unknown as OutflowsRepository;

    const useCase = new ManageCommissionSettlements(repository);

    expect(() =>
      useCase.detail(collabActor, "00000000-0000-4000-8000-000000000002", {
        from: "2026-11-01",
        to: "2026-11-30",
      }),
    ).toThrow("FINANCE_OWNER_REQUIRED");

    const result = await useCase.detail(ownerActor, "00000000-0000-4000-8000-000000000002", {
      from: "2026-11-01",
      to: "2026-11-30",
    });

    expect(result.pendingItems).toHaveLength(2);
    expect(result.summary.netPayableCents).toBe(2800);
    expect(result.settledHistory).toHaveLength(1);

    // Primeira liquidação sucede
    const settled = await useCase.record(ownerActor, {
      collaboratorId: "00000000-0000-4000-8000-000000000002",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
      paidOn: "2026-11-23",
      paymentMethod: "PIX",
      expectedAmountCents: 2800,
      requestKey: "00000000-0000-4000-8000-000000000501",
      notes: null,
    });
    expect(settled.amountCents).toBe(2800);

    // Segunda liquidação duplicada é bloqueada
    await expect(
      useCase.record(ownerActor, {
        collaboratorId: "00000000-0000-4000-8000-000000000002",
        periodStart: "2026-11-01",
        periodEnd: "2026-11-30",
        paidOn: "2026-11-23",
        paymentMethod: "PIX",
        expectedAmountCents: 0,
        requestKey: "00000000-0000-4000-8000-000000000502",
        notes: null,
      }),
    ).rejects.toThrow("FINANCE_COMMISSION_NOT_READY");
  });
});
