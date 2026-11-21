import { describe, expect, it, vi } from "vitest";
import { CollectionsError } from "../../../finance/domain/collections.js";
import { ManageInventory, type InventoryRepository } from "../manage-inventory.js";

function makeRepo(): InventoryRepository {
  return {
    listItems: vi.fn(),
    createItem: vi.fn(),
    editItem: vi.fn(),
    archiveItem: vi.fn(),
    importItems: vi.fn(),
    listMovements: vi.fn(),
    recordMovement: vi.fn(async (_companyId, input) => ({ id: "mov-1", ...input })),
    reverseMovement: vi.fn(),
    summary: vi.fn(),
  };
}

const ownerActor = {
  userId: "11111111-1111-4111-8111-111111111111",
  companyId: "11111111-1111-4111-8111-111111111111",
  role: "OWNER" as const,
};

describe("ManageInventory - SALE_OUT collaborator attribution", () => {
  it("permite SALE_OUT com collaboratorId opcional atribuído para ranking de vendas", async () => {
    const repo = makeRepo();
    const useCase = new ManageInventory(repo);
    const collaboratorId = "22222222-2222-4222-8222-222222222222";

    await useCase.record(ownerActor, {
      itemId: "33333333-3333-4333-8333-333333333333",
      movementType: "SALE_OUT",
      quantity: 2,
      unitSaleCents: 4500,
      paymentMethod: "PIX",
      collaboratorId,
      postExpense: false,
      notes: null,
      occurredOn: "2026-11-21",
      requestKey: "44444444-4444-4444-8444-444444444444",
    });

    expect(repo.recordMovement).toHaveBeenCalledWith(
      ownerActor.companyId,
      expect.objectContaining({
        movementType: "SALE_OUT",
        collaboratorId,
        paymentMethod: "PIX",
      }),
    );
  });

  it("mantém retrocompatibilidade em SALE_OUT sem collaboratorId (venda direta / balcão)", async () => {
    const repo = makeRepo();
    const useCase = new ManageInventory(repo);

    await useCase.record(ownerActor, {
      itemId: "33333333-3333-4333-8333-333333333333",
      movementType: "SALE_OUT",
      quantity: 1,
      unitSaleCents: 3000,
      paymentMethod: "CASH",
      postExpense: false,
      notes: null,
      occurredOn: "2026-11-21",
      requestKey: "55555555-5555-4555-8555-555555555555",
    });

    expect(repo.recordMovement).toHaveBeenCalledTimes(1);
  });

  it("continua exigindo collaboratorId em COLLABORATOR_WITHDRAWAL e rejeitando em PURCHASE_IN", () => {
    const repo = makeRepo();
    const useCase = new ManageInventory(repo);

    expect(() =>
      useCase.record(ownerActor, {
        itemId: "33333333-3333-4333-8333-333333333333",
        movementType: "COLLABORATOR_WITHDRAWAL",
        quantity: 1,
        postExpense: false,
        notes: null,
        occurredOn: "2026-11-21",
        requestKey: "66666666-6666-4666-8666-666666666666",
      }),
    ).toThrow(CollectionsError);

    expect(() =>
      useCase.record(ownerActor, {
        itemId: "33333333-3333-4333-8333-333333333333",
        movementType: "PURCHASE_IN",
        quantity: 5,
        collaboratorId: "22222222-2222-4222-8222-222222222222",
        postExpense: false,
        notes: null,
        occurredOn: "2026-11-21",
        requestKey: "77777777-7777-4777-8777-777777777777",
      }),
    ).toThrow(CollectionsError);
  });
});
