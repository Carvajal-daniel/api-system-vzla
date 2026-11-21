import { sql } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import type { Currency, PaymentMethod } from "../../../domain/collections.js";

type CashMovement = {
  id: string;
  appointmentId: string | null;
  clientName: string | null;
  serviceName: string;
  effectiveOn: string;
  amountInCents: number;
  method: PaymentMethod;
  currency: Currency;
  reversal: boolean;
};

export async function listCashMovements(companyId: string, filter: {
  from?: string | undefined; to?: string | undefined; collaboratorId?: string | undefined; page: number;
}) {
  const size = 50;
  const products = filter.collaboratorId ? sql.empty() : sql`
    union all
    select m.id, null::uuid, null::text, i.name, timezone(c.timezone, m.occurred_at)::date,
      m.created_at, m.total_amount_cents, m.payment_method, c.currency, m.reverses_movement_id is not null
    from inventory_movements m
    join inventory_items i on i.company_id = m.company_id and i.id = m.item_id
    join companies c on c.id = m.company_id
    where m.company_id = ${companyId} and m.movement_type = 'SALE_OUT'
      and timezone(c.timezone, m.occurred_at)::date between ${filter.from ?? "0001-01-01"}::date and ${filter.to ?? "9999-12-31"}::date
  `;
  const { rows } = await db.execute<CashMovement>(sql`
    with cash(id, appointment_id, client_name, service_name, day, recorded_at, amount_cents, method, currency, reversal) as (
      select r.id, a.id, a.client_name, a.service_name_snapshot, r.effective_on, r.recorded_at,
        r.amount_in_cents, r.method, d.currency, r.reverses_receipt_id is not null
      from receipts r
      join financial_documents d on d.company_id = r.company_id and d.id = r.document_id
      join appointments a on a.company_id = d.company_id and a.id = d.appointment_id
      where r.company_id = ${companyId}
        and r.effective_on between ${filter.from ?? "0001-01-01"}::date and ${filter.to ?? "9999-12-31"}::date
        ${filter.collaboratorId ? sql`and a.collaborator_id = ${filter.collaboratorId}` : sql.empty()}
      ${products}
    )
    select id, appointment_id as "appointmentId", client_name as "clientName", service_name as "serviceName",
      to_char(day, 'YYYY-MM-DD') as "effectiveOn", amount_cents as "amountInCents", method, currency, reversal
    from cash order by day desc, recorded_at desc, id desc limit ${size + 1} offset ${(filter.page - 1) * size}
  `);
  return { items: rows.slice(0, size), hasMore: rows.length > size };
}
