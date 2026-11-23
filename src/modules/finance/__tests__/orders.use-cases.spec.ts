import bcrypt from "bcrypt";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import {
  CreateFinanceOrder,
  GetFinanceOrder,
  ListFinanceOrders,
  ReopenFinanceOrder,
  UpdateFinanceOrder,
} from "../application/orders.use-cases.js";
import { CollectionsError } from "../domain/collections.js";
import {
  computeOrderDraft,
  type FinanceOrderRecord,
  type OrderReopenAuditInput,
  type OrdersRepository,
} from "../domain/orders.js";

const ownerActor: ActorContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-000000000010",
  role: "OWNER",
};

const collaboratorActor: ActorContext = {
  collaboratorId: "00000000-0000-4000-8000-000000000002",
  companyId: "00000000-0000-4000-8000-000000000010",
  role: "COLLABORATOR",
};

function makeOrder(overrides: Partial<FinanceOrderRecord> = {}): FinanceOrderRecord {
  return {
    id: "00000000-0000-4000-8000-000000000999",
    companyId: ownerActor.companyId,
    code: "COM-123456",
    appointmentId: null,
    clientName: "Carlos Silva",
    clientPhone: null,
    clientDocument: null,
    orderDate: "2026-11-23",
    status: "CLOSED",
    subtotalCents: 5000,
    discountCents: 0,
    totalCents: 5000,
    paidCents: 5000,
    openInCents: 0,
    notes: null,
    createdAt: new Date().toISOString(),
    items: [
      {
        id: "00000000-0000-4000-8000-000000000777",
        itemType: "SERVICE",
        referenceId: null,
        name: "Corte",
        collaboratorId: null,
        collaboratorName: null,
        quantity: 1,
        unitPriceCents: 5000,
        subtotalCents: 5000,
        commissionPercentage: 0,
        commissionCents: 0,
        commissionStatus: "NONE",
      },
    ],
    payments: [
      {
        id: "00000000-0000-4000-8000-000000000888",
        method: "PIX",
        amountCents: 5000,
        paidAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  };
}

function makeInMemoryRepository(initialOrder: FinanceOrderRecord, ownerPinHash: string | null) {
  let storedOrder: FinanceOrderRecord = { ...initialOrder };
  const auditLogs: Array<{ orderId: string; audit: OrderReopenAuditInput }> = [];

  const repository: OrdersRepository = {
    createOrder: vi.fn().mockResolvedValue(storedOrder),
    listOrders: vi.fn().mockImplementation(async () => [storedOrder]),
    getOrderById: vi.fn().mockImplementation(async (_companyId, orderId) =>
      orderId === storedOrder.id ? storedOrder : null,
    ),
    updateOrder: vi.fn().mockImplementation(async (_companyId, _orderId, draft) => {
      storedOrder = {
        ...storedOrder,
        clientName: draft.clientName,
        clientPhone: draft.clientPhone,
        clientDocument: draft.clientDocument,
        orderDate: draft.orderDate,
        status: draft.status,
        subtotalCents: draft.subtotalCents,
        discountCents: draft.discountCents,
        totalCents: draft.totalCents,
        paidCents: draft.paidCents,
        openInCents: Math.max(0, draft.totalCents - draft.paidCents),
        notes: draft.notes,
      };
      return storedOrder;
    }),
    getCompanyOwnerPinHash: vi.fn().mockResolvedValue(ownerPinHash),
    reopenOrder: vi.fn().mockImplementation(async (_companyId, orderId, audit) => {
      auditLogs.push({ orderId, audit });
      storedOrder = { ...storedOrder, status: "OPEN" };
      return storedOrder;
    }),
  };

  return { repository, auditLogs, getStoredOrder: () => storedOrder };
}

describe("Finance Orders (Comandas) domain & use cases", () => {
  it("allows standalone product sale without client and zero commission for company sales", () => {
    const draft = computeOrderDraft({
      orderDate: "2026-11-23",
      status: "OPEN",
      requestKey: "00000000-0000-4000-8000-000000000101",
      clientName: null,
      items: [
        {
          itemType: "PRODUCT",
          referenceId: "00000000-0000-4000-8000-000000000201",
          name: "Pomada Modeladora",
          collaboratorId: null, // Venda da Empresa (Sem comissão)
          quantity: 2,
          unitPriceCents: 4500,
          commissionPercentage: 15, // Deve ser ignorada quando não há profissional
        },
      ],
      payments: [{ method: "PIX", amountCents: 9000 }],
    });

    expect(draft.clientName).toBeNull();
    expect(draft.subtotalCents).toBe(9000);
    expect(draft.totalCents).toBe(9000);
    expect(draft.paidCents).toBe(9000);
    expect(draft.status).toBe("CLOSED");
    expect(draft.items[0]?.collaboratorId).toBeNull();
    expect(draft.items[0]?.commissionPercentage).toBe(0);
    expect(draft.items[0]?.commissionCents).toBe(0);
    expect(draft.items[0]?.commissionStatus).toBe("NONE");
  });

  it("calculates pending commission when a collaborator sells a product", () => {
    const draft = computeOrderDraft({
      orderDate: "2026-11-23",
      status: "CLOSED",
      requestKey: "00000000-0000-4000-8000-000000000102",
      clientName: "Carlos Silva",
      items: [
        {
          itemType: "PRODUCT",
          referenceId: "00000000-0000-4000-8000-000000000202",
          name: "Óleo para Barba",
          collaboratorId: "00000000-0000-4000-8000-000000000301",
          quantity: 1,
          unitPriceCents: 8000,
          commissionPercentage: 10,
        },
      ],
      payments: [{ method: "CASH", amountCents: 8000 }],
    });

    expect(draft.items[0]?.commissionPercentage).toBe(10);
    expect(draft.items[0]?.commissionCents).toBe(800);
    expect(draft.items[0]?.commissionStatus).toBe("PENDING");
  });

  it("delegates persistence to repository and enforces OWNER role", async () => {
    const fakeRecord = makeOrder();
    const { repository } = makeInMemoryRepository(fakeRecord, null);

    const createUseCase = new CreateFinanceOrder(repository);
    const listUseCase = new ListFinanceOrders(repository);
    const getUseCase = new GetFinanceOrder(repository);

    await expect(
      createUseCase.execute(collaboratorActor, {
        orderDate: "2026-11-23",
        status: "OPEN",
        requestKey: "00000000-0000-4000-8000-000000000103",
        items: [
          {
            itemType: "PRODUCT",
            name: "Shampoo",
            quantity: 1,
            unitPriceCents: 5000,
          },
        ],
        payments: [],
      }),
    ).rejects.toThrow("FINANCE_OWNER_REQUIRED");

    const saved = await createUseCase.execute(ownerActor, {
      code: "COM-123456",
      orderDate: "2026-11-23",
      status: "CLOSED",
      requestKey: "00000000-0000-4000-8000-000000000103",
      items: [
        {
          itemType: "PRODUCT",
          referenceId: "00000000-0000-4000-8000-000000000203",
          name: "Shampoo",
          quantity: 1,
          unitPriceCents: 5000,
        },
      ],
      payments: [{ method: "PIX", amountCents: 5000 }],
    });

    expect(saved.id).toBe(fakeRecord.id);
    expect(repository.createOrder).toHaveBeenCalledTimes(1);

    const listed = await listUseCase.execute(ownerActor, {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(listed).toHaveLength(1);

    const single = await getUseCase.execute(ownerActor, fakeRecord.id);
    expect(single.id).toBe(fakeRecord.id);
  });

  it("blocks editing items, amounts or adding payments on a CLOSED order without PIN reopen (409 CONFLICT)", async () => {
    const closedOrder = makeOrder({ status: "CLOSED" });
    const { repository } = makeInMemoryRepository(closedOrder, null);
    const updateUseCase = new UpdateFinanceOrder(repository);

    await expect(
      updateUseCase.execute(ownerActor, closedOrder.id, {
        orderDate: "2026-11-23",
        status: "CLOSED",
        items: [
          {
            itemType: "SERVICE",
            name: "Corte + Barba",
            quantity: 1,
            unitPriceCents: 9000,
          },
        ],
        payments: [
          { method: "PIX", amountCents: 5000 },
          { method: "CASH", amountCents: 4000 },
        ],
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CollectionsError &&
        err.code === "CONFLICT" &&
        err.message === "FINANCE_ORDER_CLOSED_REQUIRES_PIN",
    );

    expect(repository.updateOrder).not.toHaveBeenCalled();
  });

  it("rejects reopening when owner PIN is not configured (403) or PIN is incorrect (401)", async () => {
    const closedOrder = makeOrder({ status: "CLOSED" });

    // Caso 1: empresa sem PIN configurado
    const noPinFixture = makeInMemoryRepository(closedOrder, null);
    const reopenWithoutPin = new ReopenFinanceOrder(noPinFixture.repository);

    await expect(
      reopenWithoutPin.execute(ownerActor, closedOrder.id, {
        pin: "1234",
        reason: "Ajuste de forma de pagamento",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CollectionsError &&
        err.code === "FORBIDDEN" &&
        err.message === "OWNER_PIN_NOT_CONFIGURED",
    );

    // Caso 2: PIN incorreto
    const validHash = await bcrypt.hash("4829", 4);
    const wrongPinFixture = makeInMemoryRepository(closedOrder, validHash);
    const reopenWithWrongPin = new ReopenFinanceOrder(wrongPinFixture.repository);

    await expect(
      reopenWithWrongPin.execute(ownerActor, closedOrder.id, {
        pin: "9999",
        reason: "Ajuste de produto vendido",
      }),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof CollectionsError &&
        err.code === "UNAUTHORIZED" &&
        err.message === "OWNER_PIN_INVALID",
    );

    expect(wrongPinFixture.repository.reopenOrder).not.toHaveBeenCalled();
    expect(wrongPinFixture.auditLogs).toHaveLength(0);
  });

  it("reopens a CLOSED order with valid owner PIN, records audit log and allows controlled editing afterwards", async () => {
    const closedOrder = makeOrder({ status: "CLOSED" });
    const validHash = await bcrypt.hash("2580", 4);
    const { repository, auditLogs } = makeInMemoryRepository(closedOrder, validHash);

    const reopenUseCase = new ReopenFinanceOrder(repository);
    const updateUseCase = new UpdateFinanceOrder(repository);

    const reopened = await reopenUseCase.execute(ownerActor, closedOrder.id, {
      pin: "2580",
      reason: "Cliente adicionou pomada após fechamento",
    });

    expect(reopened.status).toBe("OPEN");
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toEqual({
      orderId: closedOrder.id,
      audit: {
        reason: "Cliente adicionou pomada após fechamento",
        authorizedById: ownerActor.userId,
        authorizedByRole: "OWNER",
      },
    });

    // Após reabertura controlada, a edição da comanda passa a ser permitida
    const updated = await updateUseCase.execute(ownerActor, closedOrder.id, {
      orderDate: "2026-11-23",
      status: "CLOSED",
      items: [
        {
          itemType: "SERVICE",
          name: "Corte",
          quantity: 1,
          unitPriceCents: 5000,
        },
        {
          itemType: "PRODUCT",
          name: "Pomada",
          quantity: 1,
          unitPriceCents: 3000,
        },
      ],
      payments: [{ method: "PIX", amountCents: 8000 }],
    });

    expect(updated.totalCents).toBe(8000);
    expect(updated.status).toBe("CLOSED");
    expect(repository.updateOrder).toHaveBeenCalledTimes(1);
  });
});
