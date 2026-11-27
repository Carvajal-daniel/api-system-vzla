
import { and, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { SubscriptionPlanTable } from "../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { getLocalDateTimeParts } from "../../../appointments/domain/services/timezone-utils.js";
import { CollectionsError } from "../../../finance/domain/collections.js";
import { computeOrderDraft, type ComputedOrderDraft, type ComputedOrderUpdateDraft } from "../../../finance/domain/orders.js";
import { coverageDayAllowed } from "../../domain/payment-policy.js";
import type { PaymentTransaction } from "./payments.repository.js";
import { ClientSubscriptionTable, ClubBenefitUseTable, PaymentChargeTable } from "./schema/payments-schema.js";

type OrderDraft = ComputedOrderDraft | ComputedOrderUpdateDraft;
type BenefitUse = typeof ClubBenefitUseTable.$inferInsert;

export async function assertNoPendingOrderCharge(tx: PaymentTransaction, companyId: string, orderId: string) {
  const [charge] = await tx.select({ id: PaymentChargeTable.id }).from(PaymentChargeTable).where(and(
    eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.referenceType, "ORDER"),
    eq(PaymentChargeTable.referenceId, orderId), eq(PaymentChargeTable.status, "PENDING"),
    or(eq(PaymentChargeTable.paymentProvider, "ASAAS"), eq(PaymentChargeTable.paymentProvider, "MERCADO_PAGO"),
      and(eq(PaymentChargeTable.paymentProvider, "SANDBOX"),
        or(isNull(PaymentChargeTable.expiresAt), gt(PaymentChargeTable.expiresAt, new Date())))),
  )).limit(1);
  if (charge) throw new CollectionsError("CONFLICT", "FINANCE_ORDER_PENDING_PAYMENT");
}

export async function assertNoConfirmedOrderCharge(tx: PaymentTransaction, companyId: string, orderId: string) {
  const [charge] = await tx.select({ id: PaymentChargeTable.id }).from(PaymentChargeTable).where(and(
    eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.referenceType, "ORDER"),
    eq(PaymentChargeTable.referenceId, orderId), eq(PaymentChargeTable.status, "CONFIRMED"),
  )).limit(1);
  if (charge) throw new CollectionsError("CONFLICT", "FINANCE_ORDER_ONLINE_PAYMENT_CONFIRMED");
}

export async function coveredOrder<T extends OrderDraft>(tx: PaymentTransaction, input: {
  companyId: string; draft: T; appointmentId: string | null; timezone: string; orderId?: string;
}): Promise<{ draft: T; use?: Omit<BenefitUse, "orderId"> }> {
  const { draft, companyId, appointmentId, timezone, orderId } = input;
  const [appointment] = appointmentId ? await tx.select().from(AppointmentTable).where(and(
    eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, appointmentId),
  )) : [];
  if (appointment?.isGuest) return { draft };
  const phone = (appointment?.clientPhone ?? draft.clientPhone)?.replace(/\D/g, "");
  if (!phone) return { draft };
  const [membership] = await tx.select({ subscription: ClientSubscriptionTable, plan: SubscriptionPlanTable })
    .from(ClientSubscriptionTable)
    .innerJoin(ClientTable, and(eq(ClientTable.companyId, companyId), eq(ClientTable.id, ClientSubscriptionTable.clientId)))
    .innerJoin(SubscriptionPlanTable, and(eq(SubscriptionPlanTable.companyId, companyId), eq(SubscriptionPlanTable.id, ClientSubscriptionTable.planId)))
    .where(and(eq(ClientSubscriptionTable.companyId, companyId), ne(ClientSubscriptionTable.status, "CANCELED"),
      sql`regexp_replace(${ClientTable.phone}, '[^0-9]', '', 'g') = ${phone}`))
    .for("update", { of: ClientSubscriptionTable }).limit(1);
  if (!membership) return { draft };

  const { plan, subscription } = membership;
  const appointmentDate = appointment && getLocalDateTimeParts(appointment.startsAt, timezone).dateString;
  const coverageDay = appointmentDate ?? draft.orderDate;
  const periodStart = subscription.currentPeriodStart;
  const now = new Date();
  let available = 0;
  const graceEnd = subscription.currentPeriodEnd &&
    new Date(subscription.currentPeriodEnd.getTime() + plan.gracePeriodDays * 86_400_000);
  if ((subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") && periodStart && graceEnd && now < graceEnd &&
    coverageDay >= getLocalDateTimeParts(periodStart, timezone).dateString &&
    coverageDay < getLocalDateTimeParts(graceEnd, timezone).dateString &&
    coverageDayAllowed(coverageDay, plan.allowedDaysOfWeek)) {
    if (plan.maxMonthlyUses === null) {
      available = Number.POSITIVE_INFINITY;
    } else {
      const [{ used } = { used: 0 }] = await tx.select({ used: sql<number>`coalesce(sum(${ClubBenefitUseTable.quantity}), 0)`.mapWith(Number) })
        .from(ClubBenefitUseTable).where(and(eq(ClubBenefitUseTable.subscriptionId, subscription.id),
          eq(ClubBenefitUseTable.periodStart, periodStart), orderId ? ne(ClubBenefitUseTable.orderId, orderId) : undefined));
      available = Math.max(0, plan.maxMonthlyUses - used);
    }
  }

  let used = 0;
  const items = draft.items.flatMap((item) => {
    if (item.itemType !== "SERVICE" || !item.referenceId) return [item];
    const quantity = plan.includedServiceIds.includes(item.referenceId) ? Math.min(item.quantity, available) : 0;
    used += quantity;
    available -= quantity;
    const billable = item.unitPriceCents === 0 && item.referenceId === appointment?.serviceId && appointment.clubFullPriceInCents !== null
      ? { ...item, unitPriceCents: appointment.clubFullPriceInCents } : item;
    if (!quantity) return [billable];
    const covered = { ...item, quantity, unitPriceCents: 0 };
    return quantity === item.quantity ? [covered] : [covered, { ...billable, quantity: item.quantity - quantity }];
  });
  if (!used && items.every((item, index) => item === draft.items[index])) return { draft };
  const computed = computeOrderDraft({
    ...draft, items, requestKey: "requestKey" in draft ? draft.requestKey : "00000000-0000-4000-8000-000000000000",
    discountCents: Math.min(draft.discountCents, items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0)),
  });
  if (computed.paidCents > computed.totalCents) {
    throw new CollectionsError("VALIDATION", "FINANCE_ORDER_PAYMENT_EXCEEDS_CLUB_TOTAL");
  }
  return {
    draft: { ...draft, items: computed.items, subtotalCents: computed.subtotalCents, totalCents: computed.totalCents,
      paidCents: computed.paidCents, discountCents: computed.discountCents, status: computed.status },
    ...(used && periodStart ? { use: { companyId, subscriptionId: subscription.id, periodStart, quantity: used } } : {}),
  };
}

export async function saveBenefitUse(tx: PaymentTransaction, companyId: string, orderId: string, use?: Omit<BenefitUse, "orderId">) {
  await tx.delete(ClubBenefitUseTable).where(and(eq(ClubBenefitUseTable.companyId, companyId), eq(ClubBenefitUseTable.orderId, orderId)));
  if (use) await tx.insert(ClubBenefitUseTable).values({ ...use, orderId });
}
