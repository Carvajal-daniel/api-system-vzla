import bcrypt from "bcrypt";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { CollectionsError } from "../domain/collections.js";
import {
  computeOrderDraft,
  computeOrderUpdateDraft,
  type CreateOrderInput,
  type FinanceOrderRecord,
  type OrderFilters,
  type OrdersRepository,
  type UpdateOrderInput,
} from "../domain/orders.js";

function assertOwner(actor: ActorContext): asserts actor is Extract<ActorContext, { role: "OWNER" }> {
  if (actor.role !== "OWNER") {
    throw new CollectionsError("FORBIDDEN", "FINANCE_OWNER_REQUIRED");
  }
}

export interface OnOrderClosedSurveyHook {
  scheduleForClosedOrder(input: {
    companyId: string;
    appointmentId: string | null;
    clientPhone?: string | null | undefined;
    clientName?: string | null | undefined;
    closedAt?: Date | undefined;
  }): Promise<unknown>;
}

export class CreateFinanceOrder {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly surveyHook?: OnOrderClosedSurveyHook,
  ) {}

  async execute(actor: ActorContext, input: CreateOrderInput): Promise<FinanceOrderRecord> {
    assertOwner(actor);
    const draft = computeOrderDraft(input);
    const created = await this.repository.createOrder(actor.companyId, draft);
    if (created.status === "CLOSED" && created.appointmentId && this.surveyHook) {
      try {
        await this.surveyHook.scheduleForClosedOrder({
          companyId: actor.companyId,
          appointmentId: created.appointmentId,
          clientPhone: created.clientPhone,
          clientName: created.clientName,
        });
      } catch {
        // Isola falha no agendamento da pesquisa pós-atendimento para não abortar o fechamento da comanda.
      }
    }
    return created;
  }
}

export class ListFinanceOrders {
  constructor(private readonly repository: OrdersRepository) {}

  async execute(actor: ActorContext, filters: OrderFilters): Promise<FinanceOrderRecord[]> {
    assertOwner(actor);
    if (filters.from && filters.to && filters.from > filters.to) {
      throw new CollectionsError("VALIDATION", "FINANCE_INVALID_DATE_RANGE");
    }
    return this.repository.listOrders(actor.companyId, filters);
  }
}

export class GetFinanceOrder {
  constructor(private readonly repository: OrdersRepository) {}

  async execute(actor: ActorContext, orderId: string): Promise<FinanceOrderRecord> {
    assertOwner(actor);
    const order = await this.repository.getOrderById(actor.companyId, orderId);
    if (!order) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    return order;
  }
}

export class UpdateFinanceOrder {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly surveyHook?: OnOrderClosedSurveyHook,
  ) {}

  async execute(
    actor: ActorContext,
    orderId: string,
    input: UpdateOrderInput,
  ): Promise<FinanceOrderRecord> {
    assertOwner(actor);
    const existing = await this.repository.getOrderById(actor.companyId, orderId);
    if (!existing) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    // Bloqueia qualquer edição de itens, valores ou novos pagamentos em comanda fechada/paga sem reabertura por PIN
    if (existing.status === "CLOSED") {
      throw new CollectionsError("CONFLICT", "FINANCE_ORDER_CLOSED_REQUIRES_PIN");
    }
    const draft = computeOrderUpdateDraft(input);
    const updated = await this.repository.updateOrder(actor.companyId, orderId, draft);
    if (updated.status === "CLOSED" && updated.appointmentId && this.surveyHook) {
      try {
        await this.surveyHook.scheduleForClosedOrder({
          companyId: actor.companyId,
          appointmentId: updated.appointmentId,
          clientPhone: updated.clientPhone,
          clientName: updated.clientName,
        });
      } catch {
        // Isola falha no agendamento da pesquisa pós-atendimento para não abortar o fechamento da comanda.
      }
    }
    return updated;
  }
}

export class ReopenFinanceOrder {
  constructor(private readonly repository: OrdersRepository) {}

  async execute(
    actor: ActorContext,
    orderId: string,
    input: { pin: string; reason: string },
  ): Promise<FinanceOrderRecord> {
    assertOwner(actor);
    const trimmedPin = input.pin.trim();
    const trimmedReason = input.reason.trim();

    if (!/^\d{4,6}$/.test(trimmedPin)) {
      throw new CollectionsError("VALIDATION", "OWNER_PIN_INVALID_FORMAT");
    }
    if (trimmedReason.length < 3 || trimmedReason.length > 500) {
      throw new CollectionsError("VALIDATION", "FINANCE_REOPEN_REASON_REQUIRED");
    }

    const existing = await this.repository.getOrderById(actor.companyId, orderId);
    if (!existing) {
      throw new CollectionsError("NOT_FOUND", "FINANCE_ORDER_NOT_FOUND");
    }
    if (existing.status !== "CLOSED") {
      throw new CollectionsError("CONFLICT", "FINANCE_ORDER_NOT_CLOSED");
    }

    // Valida existência e correspondência do PIN com hash bcrypt armazenado na empresa
    const pinHash = await this.repository.getCompanyOwnerPinHash(actor.companyId);
    if (!pinHash) {
      throw new CollectionsError("FORBIDDEN", "OWNER_PIN_NOT_CONFIGURED");
    }

    const validPin = await bcrypt.compare(trimmedPin, pinHash);
    if (!validPin) {
      throw new CollectionsError("UNAUTHORIZED", "OWNER_PIN_INVALID");
    }

    return this.repository.reopenOrder(actor.companyId, orderId, {
      reason: trimmedReason,
      authorizedById: actor.userId,
      authorizedByRole: actor.role,
    });
  }
}
