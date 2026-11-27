
import { getTableName, sql } from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { PaymentChargeTable } from "../../../../payments/infra/database/schema/payments-schema.js";
import { FinanceOrderTable } from "../schema/orders-schema.js";

const linked = alias(FinanceOrderTable, "online_order");
const charges = alias(PaymentChargeTable, "online_charge");

// Drizzle removes column qualifiers inside single-table selections, even in a subquery.
function qualified(column: string | AnyPgColumn) {
  return typeof column === "string" ? column
    : sql`${sql.identifier(getTableName(column.table))}.${sql.identifier(column.name)}`;
}

export function hasConfirmedOrderPayment(companyId: AnyPgColumn, orderId: AnyPgColumn) {
  return sql<boolean>`exists (
    select 1 from ${PaymentChargeTable} as online_charge
    where online_charge.company_id = ${qualified(companyId)} and online_charge.reference_id = ${qualified(orderId)}
      and online_charge.reference_type = 'ORDER' and online_charge.status = 'CONFIRMED'
  )`;
}

export function hasOnlineOrderForAppointment(companyId: string | AnyPgColumn, appointmentId: string | AnyPgColumn, includePending = false, exceptOrderId?: string) {
  return sql<boolean>`exists (
    select 1 from ${FinanceOrderTable} as online_order
    inner join ${PaymentChargeTable} as online_charge
      on online_charge.company_id = online_order.company_id and online_charge.reference_id = online_order.id
    where online_order.company_id = ${qualified(companyId)} and online_order.appointment_id = ${qualified(appointmentId)}
      ${exceptOrderId ? sql`and ${qualified(linked.id)} <> ${exceptOrderId}` : sql.empty()}
      and ${qualified(charges.referenceType)} = 'ORDER'
      and (online_charge.status = 'CONFIRMED' or (${includePending} and online_charge.status = 'PENDING' and
        (online_charge.payment_provider = 'ASAAS' or (online_charge.payment_provider = 'SANDBOX' and online_charge.expires_at > now()))))
  )`;
}
