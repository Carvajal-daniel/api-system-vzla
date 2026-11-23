import type { PaymentMethod } from "./collections.js";
import { CollectionsError } from "./collections.js";

export const ORDER_STATUSES = ["OPEN", "CLOSED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_ITEM_TYPES = ["SERVICE", "PRODUCT", "TIP"] as const;
export type OrderItemType = (typeof ORDER_ITEM_TYPES)[number];

export const ORDER_COMMISSION_STATUSES = ["NONE", "PENDING", "PAID"] as const;
export type OrderCommissionStatus = (typeof ORDER_COMMISSION_STATUSES)[number];

export interface CreateOrderItemInput {
  itemType: OrderItemType;
  referenceId?: string | null | undefined;
  name: string;
  // Quando null/undefined em produtos, representa "Venda da Empresa (Sem comissão)"
  collaboratorId?: string | null | undefined;
  quantity: number;
  unitPriceCents: number;
  commissionPercentage?: number | undefined;
}

export interface CreateOrderPaymentInput {
  method: PaymentMethod;
  amountCents: number;
}

export interface CreateOrderInput {
  code?: string | undefined;
  appointmentId?: string | null | undefined;
  // Cliente opcional para permitir Venda Avulsa / Produto da Empresa
  clientName?: string | null | undefined;
  clientPhone?: string | null | undefined;
  clientDocument?: string | null | undefined;
  orderDate: string;
  status: OrderStatus;
  discountCents?: number | undefined;
  notes?: string | null | undefined;
  requestKey: string;
  items: CreateOrderItemInput[];
  payments: CreateOrderPaymentInput[];
}

export interface ComputedOrderItem {
  itemType: OrderItemType;
  referenceId: string | null;
  name: string;
  collaboratorId: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  commissionPercentage: number;
  commissionCents: number;
  commissionStatus: OrderCommissionStatus;
}

export interface ComputedOrderDraft {
  code: string;
  appointmentId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientDocument: string | null;
  orderDate: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  notes: string | null;
  requestKey: string;
  items: ComputedOrderItem[];
  payments: CreateOrderPaymentInput[];
}

export interface FinanceOrderItemRecord {
  id: string;
  itemType: OrderItemType;
  referenceId: string | null;
  name: string;
  collaboratorId: string | null;
  collaboratorName: string | null;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  commissionPercentage: number;
  commissionCents: number;
  commissionStatus: OrderCommissionStatus;
}

export interface FinanceOrderPaymentRecord {
  id: string;
  method: PaymentMethod;
  amountCents: number;
  paidAt: string;
}

export interface FinanceOrderRecord {
  id: string;
  companyId: string;
  code: string;
  appointmentId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  clientDocument: string | null;
  orderDate: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  openInCents: number;
  notes: string | null;
  createdAt: string;
  items: FinanceOrderItemRecord[];
  payments: FinanceOrderPaymentRecord[];
}

export interface OrderFilters {
  from?: string | undefined;
  to?: string | undefined;
}

export interface UpdateOrderInput {
  clientName?: string | null | undefined;
  clientPhone?: string | null | undefined;
  clientDocument?: string | null | undefined;
  orderDate: string;
  status: OrderStatus;
  discountCents?: number | undefined;
  notes?: string | null | undefined;
  items: CreateOrderItemInput[];
  payments: CreateOrderPaymentInput[];
}

export interface ComputedOrderUpdateDraft {
  clientName: string | null;
  clientPhone: string | null;
  clientDocument: string | null;
  orderDate: string;
  status: OrderStatus;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  notes: string | null;
  items: ComputedOrderItem[];
  payments: CreateOrderPaymentInput[];
}

export interface OrderReopenAuditInput {
  reason: string;
  authorizedById: string;
  authorizedByRole: string;
}

export interface OrdersRepository {
  createOrder(companyId: string, draft: ComputedOrderDraft): Promise<FinanceOrderRecord>;
  listOrders(companyId: string, filters: OrderFilters): Promise<FinanceOrderRecord[]>;
  getOrderById(companyId: string, orderId: string): Promise<FinanceOrderRecord | null>;
  updateOrder(
    companyId: string,
    orderId: string,
    draft: ComputedOrderUpdateDraft,
  ): Promise<FinanceOrderRecord>;
  getCompanyOwnerPinHash(companyId: string): Promise<string | null>;
  reopenOrder(
    companyId: string,
    orderId: string,
    audit: OrderReopenAuditInput,
  ): Promise<FinanceOrderRecord>;
}

const MAX_INT = 2147483647;

/**
 * Calcula valores líquidos, comissões por item e valida invariantes da comanda antes da persistência.
 * Produtos sem profissional atribuído ("Venda da Empresa") sempre ficam com comissão zerada (NONE).
 */
export function computeOrderDraft(input: CreateOrderInput): ComputedOrderDraft {
  if (!input.items.length) {
    throw new CollectionsError("VALIDATION", "FINANCE_ORDER_ITEMS_REQUIRED");
  }

  const computedItems: ComputedOrderItem[] = input.items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_QUANTITY");
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
    }
    const subtotalCents = item.quantity * item.unitPriceCents;
    if (subtotalCents > MAX_INT) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
    }

    const collaboratorId = item.collaboratorId?.trim() || null;
    // Sem profissional atribuído => Venda da Empresa (Sem comissão)
    const commissionPercentage = collaboratorId
      ? Math.max(0, Math.min(100, Math.round(item.commissionPercentage ?? 0)))
      : 0;
    const commissionCents = collaboratorId
      ? Math.round((subtotalCents * commissionPercentage) / 100)
      : 0;
    const commissionStatus: OrderCommissionStatus =
      collaboratorId && commissionCents > 0 ? "PENDING" : "NONE";

    return {
      itemType: item.itemType,
      referenceId: item.referenceId?.trim() || null,
      name: item.name.trim(),
      collaboratorId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      subtotalCents,
      commissionPercentage,
      commissionCents,
      commissionStatus,
    };
  });

  const subtotalCents = computedItems.reduce((sum, item) => sum + item.subtotalCents, 0);
  const discountCents = Math.max(0, Math.round(input.discountCents ?? 0));
  if (discountCents > subtotalCents || subtotalCents > MAX_INT) {
    throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
  }

  const totalCents = Math.max(0, subtotalCents - discountCents);
  const paidCents = input.payments.reduce((sum, p) => {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
    }
    return sum + p.amountCents;
  }, 0);

  if (paidCents > MAX_INT) {
    throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
  }

  // Se o valor pago quitou o total, fecha a comanda automaticamente mesmo se enviada como OPEN
  const effectiveStatus: OrderStatus =
    input.status === "CLOSED" || (totalCents > 0 && paidCents >= totalCents)
      ? "CLOSED"
      : "OPEN";

  return {
    code: input.code?.trim() || `COM-${Date.now().toString().slice(-6)}`,
    appointmentId: input.appointmentId?.trim() || null,
    clientName: input.clientName?.trim() || null,
    clientPhone: input.clientPhone?.trim() || null,
    clientDocument: input.clientDocument?.trim() || null,
    orderDate: input.orderDate,
    status: effectiveStatus,
    subtotalCents,
    discountCents,
    totalCents,
    paidCents,
    notes: input.notes?.trim() || null,
    requestKey: input.requestKey,
    items: computedItems,
    payments: input.payments,
  };
}

/**
 * Recalcula valores líquidos, comissões e status efetivo para atualização controlada de comanda aberta.
 */
export function computeOrderUpdateDraft(input: UpdateOrderInput): ComputedOrderUpdateDraft {
  const full = computeOrderDraft({
    ...input,
    requestKey: "00000000-0000-4000-8000-000000000000",
  });

  return {
    clientName: full.clientName,
    clientPhone: full.clientPhone,
    clientDocument: full.clientDocument,
    orderDate: full.orderDate,
    status: full.status,
    subtotalCents: full.subtotalCents,
    discountCents: full.discountCents,
    totalCents: full.totalCents,
    paidCents: full.paidCents,
    notes: full.notes,
    items: full.items,
    payments: full.payments,
  };
}
