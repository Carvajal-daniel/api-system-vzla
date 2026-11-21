import type { PaymentMethod } from "../../finance/domain/collections.js";

export const inventoryCategories = ["RESALE_PRODUCT", "INTERNAL_SUPPLY"] as const;
export const inventoryUnits = ["UN", "ML", "G", "BOX", "OTHER"] as const;
export const movementTypes = ["PURCHASE_IN", "SALE_OUT", "COLLABORATOR_WITHDRAWAL", "INTERNAL_CONSUMPTION", "ADJUSTMENT"] as const;
export const inventorySource = "INVENTORY_MOVEMENT";
export type InventoryCategory = (typeof inventoryCategories)[number];
export type InventoryUnit = (typeof inventoryUnits)[number];
export type MovementType = (typeof movementTypes)[number];

export interface ItemFields {
  name: string;
  sku: string | null;
  category: InventoryCategory;
  unit: InventoryUnit;
  minStock: number;
  costPriceCents: number;
  salePriceCents: number | null;
}

export type NewItem = ItemFields & { initialStock: number };
export type EditItem = Partial<ItemFields & { isActive: boolean }>;
export type ItemFilters = { category?: InventoryCategory | undefined; lowStock?: boolean | undefined; search?: string | undefined; page: number };
export type MovementFilters = { itemId?: string | undefined; from?: string | undefined; to?: string | undefined; page: number };

export interface MovementInput {
  itemId: string;
  movementType: MovementType;
  quantity: number;
  unitCostCents?: number | undefined;
  unitSaleCents?: number | undefined;
  collaboratorId?: string | undefined;
  paymentMethod?: PaymentMethod | undefined;
  direction?: "IN" | "OUT" | undefined;
  postExpense: boolean;
  notes: string | null;
  occurredOn: string;
  requestKey: string;
}
