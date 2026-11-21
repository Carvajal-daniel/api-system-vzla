import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { CollectionsError } from "../../finance/domain/collections.js";
import type { EditItem, ItemFilters, MovementFilters, MovementInput, NewItem } from "../domain/inventory.js";

export interface InventoryRepository {
  listItems(companyId: string, filters: ItemFilters): Promise<unknown>;
  createItem(companyId: string, input: NewItem): Promise<unknown>;
  editItem(companyId: string, id: string, changes: EditItem): Promise<unknown>;
  archiveItem(companyId: string, id: string): Promise<void>;
  importItems(companyId: string, key: string, items: NewItem[]): Promise<{ imported: number }>;
  listMovements(companyId: string, filters: MovementFilters): Promise<unknown>;
  recordMovement(companyId: string, input: MovementInput): Promise<unknown>;
  reverseMovement(companyId: string, id: string): Promise<unknown>;
  summary(companyId: string): Promise<unknown>;
}

export class ManageInventory {
  constructor(private readonly repository: InventoryRepository) {}

  private company(actor: ActorContext) {
    if (actor.role !== "OWNER") throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
    return actor.companyId;
  }

  items(actor: ActorContext, filters: ItemFilters) { return this.repository.listItems(this.company(actor), filters); }
  create(actor: ActorContext, input: NewItem) { return this.repository.createItem(this.company(actor), input); }
  edit(actor: ActorContext, id: string, input: EditItem) { return this.repository.editItem(this.company(actor), id, input); }
  archive(actor: ActorContext, id: string) { return this.repository.archiveItem(this.company(actor), id); }
  import(actor: ActorContext, key: string, rows: NewItem[]) { return this.repository.importItems(this.company(actor), key, rows); }
  summary(actor: ActorContext) { return this.repository.summary(this.company(actor)); }
  reverse(actor: ActorContext, id: string) { return this.repository.reverseMovement(this.company(actor), id); }

  movements(actor: ActorContext, filters: MovementFilters) {
    const company = this.company(actor);
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_PERIOD");
    }
    return this.repository.listMovements(company, filters);
  }

  record(actor: ActorContext, input: MovementInput) {
    const company = this.company(actor);
    if ((input.movementType === "SALE_OUT") !== !!input.paymentMethod ||
        (input.movementType === "COLLABORATOR_WITHDRAWAL") !== !!input.collaboratorId ||
        (input.movementType === "ADJUSTMENT") !== !!input.direction ||
        (input.postExpense && input.movementType !== "PURCHASE_IN")) {
      throw new CollectionsError("VALIDATION", "INVENTORY_MOVEMENT_FIELDS");
    }
    return this.repository.recordMovement(company, input);
  }
}
