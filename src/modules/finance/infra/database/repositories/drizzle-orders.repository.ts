import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import {
  InventoryItemTable,
  InventoryMovementTable,
} from "../../../../inventory/infra/database/schema/inventory-schema.js";
import { CollectionsError } from "../../../domain/collections.js";
import type {
  ComputedOrderDraft,
  ComputedOrderUpdateDraft,
  FinanceOrderItemRecord,
  FinanceOrderPaymentRecord,
  FinanceOrderRecord,
  OrderFilters,
  OrderReopenAuditInput,
  OrdersRepository,
} from "../../../domain/orders.js";
import { FinancialDocumentTable, ReceiptTable } from "../schema/collections-schema.js";
import {
  FinanceOrderAuditLogTable,
  FinanceOrderItemTable,
  FinanceOrderPaymentTable,
  FinanceOrderTable,
} from "../schema/orders-schema.js";
import { paymentInstant, type FinanceTransaction } from "./outflow-projections.js";

const MAX_INT = 2147483647;

export class DrizzleOrdersRepository implements OrdersRepository {
  async createOrder(companyId: string, draft: ComputedOrderDraft): Promise<FinanceOrderRecord> {
    const orderId = await db.transaction(async (tx) => {
      // Idempotência: se a mesma requestKey já foi salva para a empresa, retorna o registro existente sem duplicar estoque
      const [existing] = await tx
        .select({ id: FinanceOrderTable.id })
        .from(FinanceOrderTable)
        .where(
          and(
            eq(FinanceOrderTable.companyId, companyId),
            eq(FinanceOrderTable.requestKey, draft.requestKey),
          ),
        );

      if (existing) {
        return existing.id;
      }

      const [company] = await tx
        .select({ timezone: CompanyTable.timezone })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, companyId));

      if (!company) {
        throw new CollectionsError("NOT_FOUND", "COMPANY_NOT_FOUND");
      }

      // Bloqueia criação de comanda duplicada para agendamento já pago ou já vinculado a comanda fechada
      if (draft.appointmentId) {
        const [closedOrder] = await tx
          .select({ id: FinanceOrderTable.id, status: FinanceOrderTable.status })
          .from(FinanceOrderTable)
          .where(
            and(
              eq(FinanceOrderTable.companyId, companyId),
              eq(FinanceOrderTable.appointmentId, draft.appointmentId),
              eq(FinanceOrderTable.status, "CLOSED"),
            ),
          )
          .limit(1);

        if (closedOrder) {
          throw new CollectionsError("CONFLICT", "FINANCE_ORDER_ALREADY_CLOSED");
        }

        const [financialDoc] = await tx
          .select({
            id: FinancialDocumentTable.id,
            netInCents: FinancialDocumentTable.netInCents,
          })
          .from(FinancialDocumentTable)
          .where(
            and(
              eq(FinancialDocumentTable.companyId, companyId),
              eq(FinancialDocumentTable.appointmentId, draft.appointmentId),
            ),
          )
          .limit(1);

        if (financialDoc && financialDoc.netInCents > 0) {
          const receipts = await tx
            .select({
              amountInCents: ReceiptTable.amountInCents,
              reversesReceiptId: ReceiptTable.reversesReceiptId,
            })
            .from(ReceiptTable)
            .where(
              and(
                eq(ReceiptTable.companyId, companyId),
                eq(ReceiptTable.documentId, financialDoc.id),
              ),
            );

          const collected = receipts.reduce(
            (sum, row) => sum + (row.reversesReceiptId ? -row.amountInCents : row.amountInCents),
            0,
          );
          if (collected >= financialDoc.netInCents) {
            throw new CollectionsError("CONFLICT", "FINANCE_APPOINTMENT_ALREADY_PAID");
          }
        }
      }

      // Valida que todos os colaboradores atribuídos pertencem à mesma empresa (isolamento multi-tenant)
      await this.assertValidCollaborators(tx, companyId, draft.items);

      const [createdOrder] = await tx
        .insert(FinanceOrderTable)
        .values({
          companyId,
          code: draft.code,
          appointmentId: draft.appointmentId,
          clientName: draft.clientName,
          clientPhone: draft.clientPhone,
          clientDocument: draft.clientDocument,
          orderDate: draft.orderDate,
          status: draft.status,
          subtotalCents: draft.subtotalCents,
          discountCents: draft.discountCents,
          totalCents: draft.totalCents,
          paidCents: draft.paidCents,
          notes: draft.notes,
          requestKey: draft.requestKey,
        })
        .returning({ id: FinanceOrderTable.id });

      const newOrderId = createdOrder!.id;

      await tx.insert(FinanceOrderItemTable).values(
        draft.items.map((item) => ({
          companyId,
          orderId: newOrderId,
          itemType: item.itemType,
          referenceId: item.referenceId,
          name: item.name,
          collaboratorId: item.collaboratorId,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: item.subtotalCents,
          commissionPercentage: item.commissionPercentage,
          commissionCents: item.commissionCents,
          commissionStatus: item.commissionStatus,
        })),
      );

      if (draft.payments.length > 0) {
        await tx.insert(FinanceOrderPaymentTable).values(
          draft.payments.map((payment) => ({
            companyId,
            orderId: newOrderId,
            method: payment.method,
            amountCents: payment.amountCents,
          })),
        );
      }

      // Baixa automática no estoque (SALE_OUT) para cada produto vendido dentro da mesma transação
      const saleMethod = draft.payments[0]?.method ?? "OTHER";
      const occurredAt = paymentInstant(draft.orderDate, company.timezone);
      const clientLabel = draft.clientName ?? "Venda Avulsa";

      for (const item of draft.items) {
        if (item.itemType !== "PRODUCT" || !item.referenceId) continue;

        const [stockItem] = await tx
          .select()
          .from(InventoryItemTable)
          .where(
            and(
              eq(InventoryItemTable.companyId, companyId),
              eq(InventoryItemTable.id, item.referenceId),
              eq(InventoryItemTable.isActive, true),
            ),
          )
          .for("update");

        if (!stockItem) {
          throw new CollectionsError("NOT_FOUND", "INVENTORY_NOT_FOUND");
        }

        const nextStock = stockItem.currentStock - item.quantity;
        if (nextStock < 0) {
          throw new CollectionsError("CONFLICT", "INVENTORY_INSUFFICIENT_STOCK");
        }

        const totalSaleCents = item.unitPriceCents * item.quantity;
        if (totalSaleCents > MAX_INT) {
          throw new CollectionsError("VALIDATION", "FINANCE_INVALID_AMOUNT");
        }

        await tx
          .update(InventoryItemTable)
          .set({ currentStock: nextStock, updatedAt: new Date() })
          .where(
            and(
              eq(InventoryItemTable.companyId, companyId),
              eq(InventoryItemTable.id, stockItem.id),
            ),
          );

        await tx.insert(InventoryMovementTable).values({
          companyId,
          itemId: stockItem.id,
          movementType: "SALE_OUT",
          quantity: item.quantity,
          stockDelta: -item.quantity,
          unitCostCents: stockItem.costPriceCents,
          unitSaleCents: item.unitPriceCents,
          totalAmountCents: totalSaleCents,
          collaboratorId: item.collaboratorId,
          paymentMethod: saleMethod,
          notes: `Comanda ${draft.code} (${clientLabel})`,
          occurredAt,
        });
      }

      return newOrderId;
    });

    const loaded = await this.loadOrderById(companyId, orderId);
    if (!loaded) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    return loaded;
  }

  async listOrders(companyId: string, filters: OrderFilters): Promise<FinanceOrderRecord[]> {
    const orders = await db
      .select()
      .from(FinanceOrderTable)
      .where(
        and(
          eq(FinanceOrderTable.companyId, companyId),
          filters.from ? gte(FinanceOrderTable.orderDate, filters.from) : undefined,
          filters.to ? lte(FinanceOrderTable.orderDate, filters.to) : undefined,
        ),
      )
      .orderBy(desc(FinanceOrderTable.orderDate), desc(FinanceOrderTable.createdAt));

    return this.hydrateOrders(companyId, orders);
  }

  async getOrderById(companyId: string, orderId: string): Promise<FinanceOrderRecord | null> {
    return this.loadOrderById(companyId, orderId);
  }

  async getCompanyOwnerPinHash(companyId: string): Promise<string | null> {
    const [company] = await db
      .select({ ownerPinHash: CompanyTable.ownerPinHash })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId));
    return company?.ownerPinHash ?? null;
  }

  async reopenOrder(
    companyId: string,
    orderId: string,
    audit: OrderReopenAuditInput,
  ): Promise<FinanceOrderRecord> {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ id: FinanceOrderTable.id, status: FinanceOrderTable.status })
        .from(FinanceOrderTable)
        .where(
          and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId)),
        )
        .for("update");

      if (!order) {
        throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
      }
      if (order.status !== "CLOSED") {
        throw new CollectionsError("CONFLICT", "FINANCE_ORDER_NOT_CLOSED");
      }

      // Altera status de CLOSED para OPEN e grava log de auditoria na mesma transação
      await tx
        .update(FinanceOrderTable)
        .set({ status: "OPEN", updatedAt: new Date() })
        .where(
          and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId)),
        );

      await tx.insert(FinanceOrderAuditLogTable).values({
        companyId,
        orderId,
        action: "REOPENED",
        previousStatus: "CLOSED",
        newStatus: "OPEN",
        reason: audit.reason,
        authorizedById: audit.authorizedById,
        authorizedByRole: audit.authorizedByRole,
      });
    });

    const loaded = await this.loadOrderById(companyId, orderId);
    if (!loaded) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    return loaded;
  }

  async updateOrder(
    companyId: string,
    orderId: string,
    draft: ComputedOrderUpdateDraft,
  ): Promise<FinanceOrderRecord> {
    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(FinanceOrderTable)
        .where(
          and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId)),
        )
        .for("update");

      if (!existing) {
        throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
      }

      // Proteção contra edição concorrente de comanda fechada sem reabertura prévia
      if (existing.status === "CLOSED") {
        throw new CollectionsError("CONFLICT", "FINANCE_ORDER_CLOSED_REQUIRES_PIN");
      }

      const [company] = await tx
        .select({ timezone: CompanyTable.timezone })
        .from(CompanyTable)
        .where(eq(CompanyTable.id, companyId));

      if (!company) {
        throw new CollectionsError("NOT_FOUND", "COMPANY_NOT_FOUND");
      }

      await this.assertValidCollaborators(tx, companyId, draft.items);

      // Calcula delta de estoque de produtos entre os itens anteriores e os novos itens
      const previousItems = await tx
        .select()
        .from(FinanceOrderItemTable)
        .where(
          and(
            eq(FinanceOrderItemTable.companyId, companyId),
            eq(FinanceOrderItemTable.orderId, orderId),
          ),
        );

      const previousQtyByProduct = new Map<string, number>();
      for (const item of previousItems) {
        if (item.itemType !== "PRODUCT" || !item.referenceId) continue;
        previousQtyByProduct.set(
          item.referenceId,
          (previousQtyByProduct.get(item.referenceId) ?? 0) + item.quantity,
        );
      }

      const nextQtyByProduct = new Map<string, { qty: number; unitPriceCents: number; collaboratorId: string | null }>();
      for (const item of draft.items) {
        if (item.itemType !== "PRODUCT" || !item.referenceId) continue;
        const current = nextQtyByProduct.get(item.referenceId);
        nextQtyByProduct.set(item.referenceId, {
          qty: (current?.qty ?? 0) + item.quantity,
          unitPriceCents: item.unitPriceCents,
          collaboratorId: item.collaboratorId,
        });
      }

      const allProductIds = Array.from(
        new Set([...previousQtyByProduct.keys(), ...nextQtyByProduct.keys()]),
      );

      const saleMethod = draft.payments[0]?.method ?? "OTHER";
      const occurredAt = paymentInstant(draft.orderDate, company.timezone);
      const clientLabel = draft.clientName ?? "Venda Avulsa";

      for (const productId of allProductIds) {
        const prevQty = previousQtyByProduct.get(productId) ?? 0;
        const nextEntry = nextQtyByProduct.get(productId);
        const nextQty = nextEntry?.qty ?? 0;
        const delta = nextQty - prevQty; // > 0 => precisa baixar mais estoque; < 0 => devolve estoque
        if (delta === 0) continue;

        const [stockItem] = await tx
          .select()
          .from(InventoryItemTable)
          .where(
            and(
              eq(InventoryItemTable.companyId, companyId),
              eq(InventoryItemTable.id, productId),
            ),
          )
          .for("update");

        if (!stockItem) {
          throw new CollectionsError("NOT_FOUND", "INVENTORY_NOT_FOUND");
        }

        const nextStock = stockItem.currentStock - delta;
        if (nextStock < 0) {
          throw new CollectionsError("CONFLICT", "INVENTORY_INSUFFICIENT_STOCK");
        }

        await tx
          .update(InventoryItemTable)
          .set({ currentStock: nextStock, updatedAt: new Date() })
          .where(
            and(
              eq(InventoryItemTable.companyId, companyId),
              eq(InventoryItemTable.id, stockItem.id),
            ),
          );

        const absDelta = Math.abs(delta);
        const unitSale = nextEntry?.unitPriceCents ?? stockItem.salePriceCents ?? stockItem.costPriceCents;
        const totalAmount = Math.min(MAX_INT, absDelta * (delta > 0 ? unitSale : stockItem.costPriceCents));

        if (delta > 0) {
          await tx.insert(InventoryMovementTable).values({
            companyId,
            itemId: stockItem.id,
            movementType: "SALE_OUT",
            quantity: absDelta,
            stockDelta: -absDelta,
            unitCostCents: stockItem.costPriceCents,
            unitSaleCents: unitSale,
            totalAmountCents: totalAmount,
            collaboratorId: nextEntry?.collaboratorId ?? null,
            paymentMethod: saleMethod,
            notes: `Edição Comanda ${existing.code} (${clientLabel})`,
            occurredAt,
          });
        } else {
          await tx.insert(InventoryMovementTable).values({
            companyId,
            itemId: stockItem.id,
            movementType: "ADJUSTMENT",
            quantity: absDelta,
            stockDelta: absDelta,
            unitCostCents: stockItem.costPriceCents,
            unitSaleCents: null,
            totalAmountCents: totalAmount,
            collaboratorId: null,
            paymentMethod: null,
            notes: `Estorno parcial edição Comanda ${existing.code} (${clientLabel})`,
            occurredAt,
          });
        }
      }

      // Atualiza cabeçalho, itens e pagamentos da comanda em transação única
      await tx
        .update(FinanceOrderTable)
        .set({
          clientName: draft.clientName,
          clientPhone: draft.clientPhone,
          clientDocument: draft.clientDocument,
          orderDate: draft.orderDate,
          status: draft.status,
          subtotalCents: draft.subtotalCents,
          discountCents: draft.discountCents,
          totalCents: draft.totalCents,
          paidCents: draft.paidCents,
          notes: draft.notes,
          updatedAt: new Date(),
        })
        .where(
          and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId)),
        );

      await tx
        .delete(FinanceOrderItemTable)
        .where(
          and(
            eq(FinanceOrderItemTable.companyId, companyId),
            eq(FinanceOrderItemTable.orderId, orderId),
          ),
        );

      await tx.insert(FinanceOrderItemTable).values(
        draft.items.map((item) => ({
          companyId,
          orderId,
          itemType: item.itemType,
          referenceId: item.referenceId,
          name: item.name,
          collaboratorId: item.collaboratorId,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: item.subtotalCents,
          commissionPercentage: item.commissionPercentage,
          commissionCents: item.commissionCents,
          commissionStatus: item.commissionStatus,
        })),
      );

      await tx
        .delete(FinanceOrderPaymentTable)
        .where(
          and(
            eq(FinanceOrderPaymentTable.companyId, companyId),
            eq(FinanceOrderPaymentTable.orderId, orderId),
          ),
        );

      if (draft.payments.length > 0) {
        await tx.insert(FinanceOrderPaymentTable).values(
          draft.payments.map((payment) => ({
            companyId,
            orderId,
            method: payment.method,
            amountCents: payment.amountCents,
          })),
        );
      }
    });

    const loaded = await this.loadOrderById(companyId, orderId);
    if (!loaded) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    return loaded;
  }

  private async assertValidCollaborators(
    tx: FinanceTransaction,
    companyId: string,
    items: Array<{ collaboratorId: string | null }>,
  ): Promise<void> {
    const collaboratorIds = Array.from(
      new Set(
        items
          .map((item) => item.collaboratorId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (collaboratorIds.length > 0) {
      const validCollabs = await tx
        .select({ id: CollaboratorTable.id })
        .from(CollaboratorTable)
        .where(
          and(
            eq(CollaboratorTable.companyId, companyId),
            inArray(CollaboratorTable.id, collaboratorIds),
          ),
        );
      if (validCollabs.length !== collaboratorIds.length) {
        throw new CollectionsError("VALIDATION", "FINANCE_INVALID_COLLABORATOR");
      }
    }
  }

  private async loadOrderById(
    companyId: string,
    orderId: string,
    tx?: FinanceTransaction,
  ): Promise<FinanceOrderRecord | null> {
    const runner = tx ?? db;
    const rows = await runner
      .select()
      .from(FinanceOrderTable)
      .where(and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId)));

    if (!rows.length) return null;
    const hydrated = await this.hydrateOrders(companyId, rows, tx);
    return hydrated[0] ?? null;
  }

  private async hydrateOrders(
    companyId: string,
    orders: Array<typeof FinanceOrderTable.$inferSelect>,
    tx?: FinanceTransaction,
  ): Promise<FinanceOrderRecord[]> {
    if (!orders.length) return [];
    const runner = tx ?? db;
    const orderIds = orders.map((order) => order.id);

    const [itemRows, paymentRows] = await Promise.all([
      runner
        .select({
          id: FinanceOrderItemTable.id,
          orderId: FinanceOrderItemTable.orderId,
          itemType: FinanceOrderItemTable.itemType,
          referenceId: FinanceOrderItemTable.referenceId,
          name: FinanceOrderItemTable.name,
          collaboratorId: FinanceOrderItemTable.collaboratorId,
          collaboratorName: CollaboratorTable.name,
          quantity: FinanceOrderItemTable.quantity,
          unitPriceCents: FinanceOrderItemTable.unitPriceCents,
          subtotalCents: FinanceOrderItemTable.subtotalCents,
          commissionPercentage: FinanceOrderItemTable.commissionPercentage,
          commissionCents: FinanceOrderItemTable.commissionCents,
          commissionStatus: FinanceOrderItemTable.commissionStatus,
        })
        .from(FinanceOrderItemTable)
        .leftJoin(
          CollaboratorTable,
          and(
            eq(CollaboratorTable.id, FinanceOrderItemTable.collaboratorId),
            eq(CollaboratorTable.companyId, FinanceOrderItemTable.companyId),
          ),
        )
        .where(
          and(
            eq(FinanceOrderItemTable.companyId, companyId),
            inArray(FinanceOrderItemTable.orderId, orderIds),
          ),
        ),
      runner
        .select()
        .from(FinanceOrderPaymentTable)
        .where(
          and(
            eq(FinanceOrderPaymentTable.companyId, companyId),
            inArray(FinanceOrderPaymentTable.orderId, orderIds),
          ),
        ),
    ]);

    const itemsByOrder = new Map<string, FinanceOrderItemRecord[]>();
    for (const row of itemRows) {
      const list = itemsByOrder.get(row.orderId) ?? [];
      list.push({
        id: row.id,
        itemType: row.itemType,
        referenceId: row.referenceId,
        name: row.name,
        collaboratorId: row.collaboratorId,
        collaboratorName: row.collaboratorName ?? null,
        quantity: row.quantity,
        unitPriceCents: row.unitPriceCents,
        subtotalCents: row.subtotalCents,
        commissionPercentage: row.commissionPercentage,
        commissionCents: row.commissionCents,
        commissionStatus: row.commissionStatus,
      });
      itemsByOrder.set(row.orderId, list);
    }

    const paymentsByOrder = new Map<string, FinanceOrderPaymentRecord[]>();
    for (const row of paymentRows) {
      const list = paymentsByOrder.get(row.orderId) ?? [];
      list.push({
        id: row.id,
        method: row.method,
        amountCents: row.amountCents,
        paidAt: row.paidAt.toISOString(),
      });
      paymentsByOrder.set(row.orderId, list);
    }

    return orders.map((order) => ({
      id: order.id,
      companyId: order.companyId,
      code: order.code,
      appointmentId: order.appointmentId,
      clientName: order.clientName,
      clientPhone: order.clientPhone,
      clientDocument: order.clientDocument,
      orderDate: order.orderDate,
      status: order.status,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      paidCents: order.paidCents,
      openInCents: Math.max(0, order.totalCents - order.paidCents),
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      items: itemsByOrder.get(order.id) ?? [],
      payments: paymentsByOrder.get(order.id) ?? [],
    }));
  }
}
