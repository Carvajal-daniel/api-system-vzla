import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { config } from "dotenv";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { AppointmentTable } from "../../../modules/appointments/infra/database/schema/appointments-schema.js";
import { ScheduleBlockTable } from "../../../modules/appointments/infra/database/schema/schedule-blocks-schema.js";
import { getLocalDateTimeParts, localDateTimeToUtc, parseLocalDateString, parseLocalTimeString } from "../../../modules/appointments/domain/services/timezone-utils.js";
import type { AppointmentStatusValue } from "../../../modules/appointments/domain/value-objects/appointment-status.vo.js";
import { CollaboratorTable } from "../../../modules/Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../modules/Company/infra/database/schema/companies-schema.js";
import type { Currency } from "../../../modules/finance/domain/collections.js";
import { FinancialDocumentTable, ReceiptTable } from "../../../modules/finance/infra/database/schema/collections-schema.js";
import { CommissionDeductionApplicationTable, CommissionDeductionTable, CommissionSettlementTable, ExpenseTable } from "../../../modules/finance/infra/database/schema/outflows-schema.js";
import { inventorySource } from "../../../modules/inventory/domain/inventory.js";
import { InventoryItemTable, InventoryMovementTable } from "../../../modules/inventory/infra/database/schema/inventory-schema.js";
import { CollaboratorServiceTable } from "../../../modules/services/infra/database/schema/collaborator-services-schema.js";
import { ServiceTable } from "../../../modules/services/infra/database/schema/services-schema.js";
import { WorkScheduleTable } from "../../../modules/work-schedules/infra/database/schema/work-schedules-schema.js";

type Database = typeof import("../database.js").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Company = typeof CompanyTable.$inferSelect;
type Appointment = typeof AppointmentTable.$inferInsert;
type Expense = typeof ExpenseTable.$inferInsert;
type Block = Pick<typeof ScheduleBlockTable.$inferSelect, "startsAt" | "endsAt">;
type SeedId = (key: string) => string;

const staff = [
  { name: "Rafael Monteiro", specialty: "Cortes clássicos e degradê", commissionPercentage: 50 },
  { name: "Diego Nascimento", specialty: "Barboterapia e visagismo", commissionPercentage: 45 },
  { name: "Bruno Almeida", specialty: "Tratamentos capilares e acabamento", commissionPercentage: 40 },
] as const;

const catalog = [
  { name: "Corte Masculino", durationMinutes: 40, brl: 6500, usd: 2200 },
  { name: "Barba Terapia", durationMinutes: 35, brl: 5500, usd: 1700 },
  { name: "Combo Corte + Barba", durationMinutes: 65, brl: 10500, usd: 3400 },
  { name: "Sobrancelha", durationMinutes: 15, brl: 2000, usd: 700 },
  { name: "Hidratação Capilar", durationMinutes: 30, brl: 4500, usd: 1500 },
  { name: "Pigmentação", durationMinutes: 45, brl: 7500, usd: 2500 },
] as const;

const clients = [
  "Lucas Ferreira", "Pedro Ribeiro", "Gabriel Costa", "Matheus Rocha", "André Lima", "Felipe Martins",
  "João Carvalho", "Gustavo Dias", "Thiago Lopes", "Daniel Santos", "Vinícius Souza", "Marcelo Torres",
  "Eduardo Gomes", "Renato Pereira", "Caio Rodrigues", "Leonardo Silva", "Ricardo Barbosa", "Vitor Mendes",
] as const;
const paymentMethods = ["PIX", "CASH", "CREDIT_CARD", "PIX", "DEBIT_CARD"] as const;
const serviceMix = [0, 2, 0, 1, 4, 2, 0, 5, 1, 3, 2, 0] as const;

function demoId(companyId: string): SeedId {
  return (key) => {
    const hex = createHash("sha256").update(`demo-seed:${companyId}:${key}`).digest("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
}

function cycle<T>(values: readonly T[], index: number): T {
  return values[index % values.length]!;
}

function changeDay(day: string, offset: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function localInstant(day: string, minutes: number, timezone: string) {
  const { year, month, day: date } = parseLocalDateString(day);
  return localDateTimeToUtc(year, month, date, Math.floor(minutes / 60), minutes % 60, timezone);
}

function weeklyHours(company: Company) {
  const schedule = company.operatingSchedule as
    { dayOfWeek: number; isOpen: boolean; openTime?: string; closeTime?: string }[] | null;
  const operatingDays = company.operatingDays?.split(",").map((day) => Number(day.trim()));
  return Array.from({ length: 7 }, (_, weekday) => {
    const entry = Array.isArray(schedule) ? schedule.find((day) => day.dayOfWeek === weekday) : undefined;
    if (entry) return entry.isOpen && entry.openTime && entry.closeTime
      ? { open: entry.openTime.slice(0, 5), close: entry.closeTime.slice(0, 5) } : null;
    return (operatingDays?.includes(weekday) ?? weekday !== 0) ? { open: "09:00", close: "19:00" } : null;
  });
}

function toMinutes(time: string) {
  const { hour, minute } = parseLocalTimeString(time);
  return hour * 60 + minute;
}

function planAppointments(
  company: Company, id: SeedId, hours: ReturnType<typeof weeklyHours>, blocks: Block[],
  range: { from: string; to: string; key: string; past: boolean; statuses: AppointmentStatusValue[] }, asOf: Date,
) {
  const days = [];
  for (let day = range.from; day <= range.to; day = changeDay(day, 1)) {
    const hoursForDay = hours[new Date(`${day}T00:00:00Z`).getUTCDay()];
    if (hoursForDay) days.push({ day, start: toMinutes(hoursForDay.open), close: toMinutes(hoursForDay.close) });
  }
  const rows: { day: string; appointment: Appointment }[] = [];
  const periodOffset = range.key === "previous" ? 0 : range.key === "current" ? 4 : 9;

  // One pass per time of day spreads the fixtures across the calendar before filling crowded dates.
  for (let pass = 0; pass < 12 && rows.length < range.statuses.length; pass++) {
    for (const [dayIndex, slot] of days.entries()) {
      const index = rows.length;
      const status = range.statuses[index];
      if (!status) break;
      const serviceIndex = cycle(serviceMix, index + periodOffset);
      const service = catalog[serviceIndex];
      const personIndex = (index + periodOffset) % staff.length;
      const startMinute = slot.start + pass * 75 + (dayIndex * 17 % 5) * 5;
      const endMinute = startMinute + service.durationMinutes;
      if (endMinute > slot.close) continue;
      const startsAt = localInstant(slot.day, startMinute, company.timezone);
      const endsAt = localInstant(slot.day, endMinute, company.timezone);
      if (range.past && endsAt > asOf) continue;
      if (blocks.some((block) => startsAt < block.endsAt && endsAt > block.startsAt)) continue;
      const client = (index + periodOffset * 2) % clients.length;
      const bookedAt = localInstant(changeDay(slot.day, -2), 540, company.timezone);
      const createdAt = bookedAt < asOf ? bookedAt : asOf;
      rows.push({ day: slot.day, appointment: {
        id: id(`appointment:${range.key}:${index}`), companyId: company.id,
        collaboratorId: id(`staff:${personIndex}`), serviceId: id(`service:${serviceIndex}`),
        clientName: clients[client]!, clientPhone: `1190000${String(1000 + client)}`, startsAt, endsAt, status,
        cancellationReason: status === "CANCELED" ? "Cliente pediu para remarcar" : null,
        completedAt: status === "COMPLETED" ? endsAt : null,
        serviceNameSnapshot: service.name, serviceDurationMinutesSnapshot: service.durationMinutes,
        servicePriceInCentsSnapshot: company.currency === "BRL" ? service.brl : service.usd,
        commissionPercentageSnapshot: staff[personIndex]!.commissionPercentage,
        createdAt, updatedAt: range.past ? endsAt : createdAt,
      } });
    }
  }
  return rows.sort((a, b) => a.appointment.startsAt.getTime() - b.appointment.startsAt.getTime());
}

async function clearOperationalData(tx: Transaction, companyId: string) {
  await tx.delete(InventoryMovementTable).where(eq(InventoryMovementTable.companyId, companyId));
  await tx.delete(InventoryItemTable).where(eq(InventoryItemTable.companyId, companyId));
  await tx.delete(CommissionDeductionApplicationTable).where(eq(CommissionDeductionApplicationTable.companyId, companyId));
  await tx.delete(ReceiptTable).where(eq(ReceiptTable.companyId, companyId));
  // Documents and deductions reference settlements, so both must go before settlements.
  await tx.delete(FinancialDocumentTable).where(eq(FinancialDocumentTable.companyId, companyId));
  await tx.delete(CommissionDeductionTable).where(eq(CommissionDeductionTable.companyId, companyId));
  await tx.delete(CommissionSettlementTable).where(eq(CommissionSettlementTable.companyId, companyId));
  await tx.delete(ExpenseTable).where(eq(ExpenseTable.companyId, companyId));
  await tx.delete(AppointmentTable).where(eq(AppointmentTable.companyId, companyId));
  await tx.delete(CollaboratorServiceTable).where(eq(CollaboratorServiceTable.companyId, companyId));
  await tx.delete(WorkScheduleTable).where(eq(WorkScheduleTable.companyId, companyId));
  await tx.delete(ScheduleBlockTable).where(and(eq(ScheduleBlockTable.companyId, companyId),
    isNotNull(ScheduleBlockTable.collaboratorId)));
  await tx.delete(ServiceTable).where(eq(ServiceTable.companyId, companyId));
  await tx.delete(CollaboratorTable).where(eq(CollaboratorTable.companyId, companyId));
}

async function seedTeam(tx: Transaction, company: Company, id: SeedId, hours: ReturnType<typeof weeklyHours>, createdAt: Date, password: string) {
  const companyId = company.id;
  // Demo addresses are non-routable and the login password is random and undisclosed.
  await tx.insert(CollaboratorTable).values(staff.map((person, index) => ({
    ...person, companyId, password, id: id(`staff:${index}`),
    email: `demo-${companyId}-${index + 1}@example.invalid`, phone: `1190000200${index + 1}`,
  })));
  await tx.insert(ServiceTable).values(catalog.map(({ brl, usd, ...service }, index) => ({
    ...service, companyId, id: id(`service:${index}`), priceInCents: company.currency === "BRL" ? brl : usd,
    createdAt, updatedAt: createdAt,
  })));
  await tx.insert(CollaboratorServiceTable).values(staff.flatMap((person, staffIndex) => catalog.map((_, serviceIndex) => ({
    id: id(`qualification:${staffIndex}:${serviceIndex}`), companyId, collaboratorId: id(`staff:${staffIndex}`),
    serviceId: id(`service:${serviceIndex}`), commissionPercentage: person.commissionPercentage, createdAt, updatedAt: createdAt,
  }))));
  await tx.insert(WorkScheduleTable).values(staff.flatMap((_, staffIndex) => hours.map((entry, dayOfWeek) => ({
    id: id(`work:${staffIndex}:${dayOfWeek}`), companyId, collaboratorId: id(`staff:${staffIndex}`), dayOfWeek,
    isWorkingDay: !!entry, startTime: entry?.open ?? null, endTime: entry?.close ?? null, createdAt, updatedAt: createdAt,
  }))));
}

function calendar(company: Company, now: Date) {
  const today = getLocalDateTimeParts(now, company.timezone).dateString;
  const currentStart = `${today.slice(0, 7)}-01`;
  const previousEnd = changeDay(currentStart, -1);
  const previousStart = `${previousEnd.slice(0, 7)}-01`;
  const nextStart = `${changeDay(currentStart, 32).slice(0, 7)}-01`;
  const currentEnd = changeDay(nextStart, -1);
  const instant = (day: string, minutes = 720) => localInstant(day, minutes, company.timezone);
  // Use the local start of today so repeating the seed later the same day reproduces the rows.
  const asOf = instant(today, 0);
  const posted = (day: string, minutes = 720) => new Date(Math.min(asOf.getTime(), instant(day, minutes).getTime()));
  return { today, asOf, currentStart, currentEnd, previousStart, previousEnd, instant, posted };
}

type Calendar = ReturnType<typeof calendar>;

async function seedExpenses(tx: Transaction, companyId: string, id: SeedId, dates: Calendar, currency: Currency) {
  const currentDay = (day: number) => [changeDay(dates.currentStart, day - 1), dates.today].sort()[0]!;
  const entries = [
    { key: "last-rent", description: "Aluguel da barbearia", category: "RENT", dueDate: changeDay(dates.previousStart, 4), brl: 115000, usd: 32000, status: "PAID", recurring: true },
    { key: "last-power", description: "Energia elétrica", category: "UTILITIES", dueDate: changeDay(dates.previousStart, 10), brl: 23840, usd: 5800, status: "PAID", recurring: true },
    { key: "last-internet", description: "Internet fibra", category: "UTILITIES", dueDate: changeDay(dates.previousStart, 14), brl: 10990, usd: 3200, status: "PAID", recurring: true },
    { key: "rent", description: "Aluguel da barbearia", category: "RENT", dueDate: currentDay(5), brl: 115000, usd: 32000, status: "PAID", recurring: true },
    { key: "internet", description: "Internet fibra", category: "UTILITIES", dueDate: currentDay(10), brl: 10990, usd: 3200, status: "PAID", recurring: true },
    { key: "power", description: "Energia elétrica", category: "UTILITIES", dueDate: dates.currentEnd, brl: 28570, usd: 6500, status: "PENDING", recurring: true },
    { key: "marketing", description: "Campanha local nas redes sociais", category: "MARKETING", dueDate: dates.currentEnd, brl: 14000, usd: 4500, status: "PENDING", recurring: false },
    { key: "maintenance", description: "Revisão das máquinas de corte", category: "MAINTENANCE", dueDate: changeDay(dates.today, -1), brl: 16700, usd: 5400, status: "OVERDUE", recurring: false },
  ] as const;
  await tx.insert(ExpenseTable).values(entries.map((entry): Expense => ({
    id: id(`expense:${entry.key}`), companyId, description: entry.description, category: entry.category,
    expenseType: entry.recurring ? "FIXED" : "VARIABLE", amountCents: currency === "BRL" ? entry.brl : entry.usd,
    dueDate: entry.dueDate, status: entry.status, isRecurring: entry.recurring,
    paymentMethod: entry.status === "PAID" ? "PIX" : null, paidAt: entry.status === "PAID" ? dates.posted(entry.dueDate) : null,
    createdAt: dates.posted(changeDay(entry.dueDate, entry.status === "PENDING" ? -15 : -1)),
  })));
}

const products = [
  { name: "Pomada matte 90 g", sku: "POM-MATTE", bought: 16, sold: 3, taken: 0, used: 0, minStock: 5, cost: 1800, price: 3900 },
  { name: "Óleo para barba 30 ml", sku: "OLE-BARBA", bought: 5, sold: 2, taken: 1, used: 0, minStock: 3, cost: 1400, price: 3200 },
  { name: "Shampoo antirresíduos 250 ml", sku: "SHA-ANTI", bought: 3, sold: 3, taken: 0, used: 0, minStock: 2, cost: 1850, price: 3900 },
  { name: "Balm pós-barba 100 ml", sku: "BAL-POS", bought: 9, sold: 2, taken: 0, used: 0, minStock: 3, cost: 1650, price: 3600 },
  { name: "Lâminas descartáveis (caixa)", sku: "LAM-CAIXA", bought: 10, sold: 0, taken: 0, used: 3, minStock: 2, cost: 1250, price: null },
  { name: "Toalhas descartáveis (caixa)", sku: "TOA-CAIXA", bought: 4, sold: 0, taken: 0, used: 3, minStock: 2, cost: 2390, price: null },
] as const;

async function seedInventory(tx: Transaction, company: Company, id: SeedId, dates: Calendar) {
  type Movement = typeof InventoryMovementTable.$inferInsert;
  const companyId = company.id;
  const purchaseDay = changeDay(dates.previousStart, 6);
  const withdrawalDay = dates.currentStart;
  const deductionId = id("deduction:withdrawal");
  let withdrawalCost = 0;
  const movements: Movement[] = [];
  const expenses: Expense[] = [];
  const items = products.map((product, index): typeof InventoryItemTable.$inferInsert => {
    const { name, sku, minStock, bought, sold, taken, used } = product;
    const itemId = id(`item:${sku}`);
    const purchaseId = id(`purchase:${sku}`);
    const expenseId = id(`purchase-expense:${sku}`);
    const unitCostCents = company.currency === "BRL" ? product.cost : Math.round(product.cost / 4);
    const unitSaleCents = product.price === null ? null : company.currency === "BRL" ? product.price : Math.round(product.price / 4);
    const purchasedAt = dates.instant(purchaseDay);
    const common = { companyId, itemId, unitCostCents };
    movements.push({ ...common, id: purchaseId, movementType: "PURCHASE_IN", quantity: bought, stockDelta: bought,
      totalAmountCents: bought * unitCostCents, financeReferenceType: "EXPENSE", financeReferenceId: expenseId,
      occurredAt: purchasedAt, createdAt: purchasedAt });
    expenses.push({ id: expenseId, companyId, description: `Reposição de estoque: ${name}`, category: "STOCK_PURCHASE",
      expenseType: "VARIABLE", quantity: bought, unitAmountCents: unitCostCents, amountCents: bought * unitCostCents,
      dueDate: purchaseDay, paidAt: purchasedAt, status: "PAID", paymentMethod: "PIX", createdAt: purchasedAt,
      externalSourceType: inventorySource, externalSourceId: purchaseId });
    if (sold && unitSaleCents) {
      const saleId = id(`sale:${sku}`);
      const saleDay = changeDay(index % 2 ? dates.currentStart : dates.previousEnd, index % 2 ? 0 : -3);
      const saleAt = dates.posted(saleDay);
      // Cash reporting treats the SALE_OUT movement itself as the product revenue.
      movements.push({ ...common, id: saleId, movementType: "SALE_OUT", quantity: sold, stockDelta: -sold,
        unitSaleCents, totalAmountCents: sold * unitSaleCents, paymentMethod: cycle(paymentMethods, index),
        financeReferenceType: "PRODUCT_SALE", financeReferenceId: saleId, occurredAt: saleAt, createdAt: saleAt });
    }
    if (taken) {
      withdrawalCost = taken * unitCostCents;
      const withdrawAt = dates.posted(withdrawalDay);
      movements.push({ ...common, id: id("withdrawal"), movementType: "COLLABORATOR_WITHDRAWAL", quantity: taken,
        stockDelta: -taken, totalAmountCents: withdrawalCost, collaboratorId: id("staff:1"),
        financeReferenceType: "COMMISSION_DEDUCTION", financeReferenceId: deductionId,
        occurredAt: withdrawAt, createdAt: withdrawAt });
    }
    if (used) {
      const consumedAt = dates.posted(dates.currentStart);
      movements.push({ ...common, id: id(`consumption:${sku}`), movementType: "INTERNAL_CONSUMPTION", quantity: used,
        stockDelta: -used, totalAmountCents: used * unitCostCents, occurredAt: consumedAt, createdAt: consumedAt });
    }
    return { companyId, id: itemId, name, sku, minStock, currentStock: bought - sold - taken - used,
      category: unitSaleCents === null ? "INTERNAL_SUPPLY" : "RESALE_PRODUCT", unit: unitSaleCents === null ? "BOX" : "UN",
      costPriceCents: unitCostCents, salePriceCents: unitSaleCents, createdAt: purchasedAt, updatedAt: dates.posted(dates.currentStart) };
  });
  await tx.insert(InventoryItemTable).values(items);
  await tx.insert(ExpenseTable).values(expenses);
  await tx.insert(CommissionDeductionTable).values({
    id: deductionId, companyId, collaboratorId: id("staff:1"), description: "Retirada de óleo para barba 30 ml",
    category: "STOCK_PRODUCT", amountCents: withdrawalCost, unitAmountCents: withdrawalCost, deductedAt: withdrawalDay,
    externalSourceType: inventorySource, externalSourceId: id("withdrawal"), createdAt: dates.posted(withdrawalDay),
  });
  await tx.insert(InventoryMovementTable).values(movements);
  return { deductionId, withdrawalCost };
}

async function seedCollections(
  tx: Transaction, company: Company, id: SeedId, dates: Calendar,
  periods: { previous: ReturnType<typeof planAppointments>; current: ReturnType<typeof planAppointments>; future: ReturnType<typeof planAppointments> },
  withdrawal: Awaited<ReturnType<typeof seedInventory>>,
) {
  type Document = typeof FinancialDocumentTable.$inferInsert;
  type Receipt = typeof ReceiptTable.$inferInsert;
  const companyId = company.id;
  const documents: Document[] = [];
  const receipts: Receipt[] = [];
  const previousCompleted = periods.previous.filter(({ appointment }) => appointment.status === "COMPLETED");
  const currentCompleted = periods.current.filter(({ appointment }) => appointment.status === "COMPLETED");
  const advance = periods.future.find(({ appointment }) => appointment.status === "CONFIRMED");
  const incomplete = new Set(currentCompleted.slice(-3).map(({ appointment }) => appointment.id));
  const paidAppointments = new Map<string, { settlementId: string; paidAt: Date }>();

  for (const [index] of staff.entries()) {
    const person = id(`staff:${index}`);
    const groups = [{ rows: previousCompleted, from: dates.previousStart, to: dates.previousEnd, previous: true }];
    if (index === 1) {
      const rows = currentCompleted.filter(({ appointment }) => appointment.collaboratorId === person && !incomplete.has(appointment.id));
      const nextUnpaid = rows[2];
      // Settlements pay whole documents. A partial month pays just the first part of the professional's period.
      const cutoff = nextUnpaid ? changeDay(nextUnpaid.day, -1) : rows.at(-1)?.day;
      if (cutoff) groups.push({ rows, from: dates.currentStart, to: cutoff, previous: false });
    }
    for (const group of groups) {
      const eligible = group.rows.filter(({ day, appointment }) => day <= group.to && appointment.collaboratorId === person);
      if (!eligible.length) continue;
      const gross = eligible.reduce((sum, { appointment }) => sum + generatedCommission(appointment), 0);
      const applied = group.previous ? 0 : Math.min(gross, withdrawal.withdrawalCost);
      const settlementId = id(`settlement:${group.previous ? "previous" : "current"}:${index}`);
      const paidAt = group.previous ? new Date(dates.instant(dates.previousEnd, 1439).getTime() + 59_000)
        : dates.posted(dates.currentStart);
      const actualPaidAt = new Date(Math.max(paidAt.getTime(), eligible.at(-1)!.appointment.endsAt.getTime()));
      await tx.insert(CommissionSettlementTable).values({
        id: settlementId, companyId, collaboratorId: person, periodStart: group.from, periodEnd: group.to,
        amountCents: gross - applied, paymentMethod: "PIX", paidAt: actualPaidAt, createdAt: actualPaidAt, recordedBy: companyId,
        requestKey: id(`request:${settlementId}`), notes: group.previous ? "Fechamento de comissão do mês" : "Repasse da primeira parte do mês",
      });
      for (const { appointment } of eligible) paidAppointments.set(appointment.id!, { settlementId, paidAt: actualPaidAt });
      if (applied) {
        await tx.insert(CommissionDeductionApplicationTable).values({ companyId, deductionId: withdrawal.deductionId, settlementId, amountCents: applied });
        if (applied === withdrawal.withdrawalCost) await tx.update(CommissionDeductionTable).set({ settlementId }).where(and(
          eq(CommissionDeductionTable.companyId, companyId), eq(CommissionDeductionTable.id, withdrawal.deductionId),
        ));
      }
    }
  }

  const collected = [...previousCompleted, ...currentCompleted, ...(advance ? [advance] : [])];
  for (const [index, { day, appointment }] of collected.entries()) {
    const appointmentId = appointment.id!;
    const documentId = id(`document:${appointmentId}`);
    const advancePayment = appointment.status === "CONFIRMED";
    const netInCents = appointment.servicePriceInCentsSnapshot;
    const settlement = paidAppointments.get(appointmentId);
    const recordedAt = advancePayment ? dates.asOf : appointment.endsAt;
    documents.push({ id: documentId, companyId, appointmentId, currency: company.currency, netInCents,
      generatedCommissionInCents: advancePayment ? null : generatedCommission(appointment),
      commissionPaidAt: settlement?.paidAt ?? null, commissionPaidBy: settlement ? companyId : null,
      commissionSettlementId: settlement?.settlementId ?? null, createdAt: recordedAt });
    receipts.push({ id: id(`receipt:${appointmentId}`), companyId, documentId, requestKey: id(`receipt-request:${appointmentId}`),
      amountInCents: advancePayment ? Math.min(2000, Math.round(netInCents * 0.3))
        : incomplete.has(appointmentId) ? Math.round(netInCents / 4) : netInCents,
      method: advancePayment ? "PIX" : cycle(paymentMethods, index),
      effectiveOn: advancePayment ? dates.today : day, recordedAt, recordedBy: companyId, position: 0 });
  }
  if (documents.length) await tx.insert(FinancialDocumentTable).values(documents);
  if (receipts.length) await tx.insert(ReceiptTable).values(receipts);
}

function generatedCommission(appointment: Appointment) {
  return Math.round(appointment.servicePriceInCentsSnapshot * appointment.commissionPercentageSnapshot / 100);
}

async function protectOtherCompanies(tx: Transaction, companyId: string) {
  // These parent locks also prevent another tenant from acquiring a new FK reference during cleanup.
  await tx.select({ id: CollaboratorTable.id }).from(CollaboratorTable).where(eq(CollaboratorTable.companyId, companyId)).for("update");
  await tx.select({ id: ServiceTable.id }).from(ServiceTable).where(eq(ServiceTable.companyId, companyId)).for("update");
  const result = await tx.execute<{ invalid: boolean }>(sql`
    select exists (
      select 1 from (
        select company_id, collaborator_id from collaborator_services
        union all select company_id, collaborator_id from work_schedules
        union all select company_id, collaborator_id from schedule_blocks
      ) child join collaborators parent on parent.id = child.collaborator_id
      where parent.company_id = ${companyId} and child.company_id <> parent.company_id
      union all
      select 1 from collaborator_services child join services parent on parent.id = child.service_id
      where parent.company_id = ${companyId} and child.company_id <> parent.company_id
    ) as invalid
  `);
  if (result.rows[0]?.invalid) throw new Error("Há vínculos entre empresas que impedem a limpeza com segurança.");
}

async function verifyOrphans(tx: Transaction, companyId: string) {
  const foreignKeys = await tx.execute<{
    name: string; child: string; parent: string; child_keys: string[]; parent_keys: string[]; parent_scoped: boolean;
  }>(sql`
    select fk.conname as name, child.relname as child, parent.relname as parent,
      array_agg(src.attname::text order by key.pos) as child_keys,
      array_agg(dst.attname::text order by key.pos) as parent_keys,
      exists (select 1 from pg_attribute where attrelid = parent.oid and attname = 'company_id' and not attisdropped) as parent_scoped
    from pg_constraint fk
    join pg_class child on child.oid = fk.conrelid
    join pg_class parent on parent.oid = fk.confrelid
    cross join lateral unnest(fk.conkey, fk.confkey) with ordinality as key(src, dst, pos)
    join pg_attribute src on src.attrelid = child.oid and src.attnum = key.src
    join pg_attribute dst on dst.attrelid = parent.oid and dst.attnum = key.dst
    where fk.contype = 'f' and child.relnamespace = 'public'::regnamespace and parent.relnamespace = child.relnamespace
      and exists (select 1 from pg_attribute where attrelid = child.oid and attname = 'company_id' and not attisdropped)
    group by fk.oid, fk.conname, child.relname, parent.relname, parent.oid
  `);
  if (!foreignKeys.rows.length) throw new Error("Nenhuma chave estrangeira encontrada para verificar a integridade.");
  const checks: SQL[] = foreignKeys.rows.map(({ name, child, parent, child_keys, parent_keys, parent_scoped }) => {
    const match = child_keys.map((key, index) => sql`c.${sql.identifier(key)} = p.${sql.identifier(parent_keys[index]!)}`);
    if (parent_scoped && !child_keys.includes("company_id")) match.push(sql`c.company_id = p.company_id`);
    return sql`select ${name}::text as relation, count(*)::integer as orphans from public.${sql.identifier(child)} c
      where c.company_id = ${companyId} and ${sql.join(child_keys.map((key) => sql`c.${sql.identifier(key)} is not null`), sql` and `)}
      and not exists (select 1 from public.${sql.identifier(parent)} p where ${sql.join(match, sql` and `)})`;
  });
  checks.push(sql`
    SELECT 'vínculos financeiros do estoque', count(*)::integer FROM inventory_movements m
    WHERE m.company_id = ${companyId} AND (
      (m.finance_reference_type = 'EXPENSE' AND NOT EXISTS (
        SELECT 1 FROM expenses e WHERE e.company_id = m.company_id AND e.id = m.finance_reference_id
          AND e.external_source_type = ${inventorySource} AND e.external_source_id = m.id::text))
      OR (m.finance_reference_type = 'COMMISSION_DEDUCTION' AND NOT EXISTS (
        SELECT 1 FROM commission_deductions d WHERE d.company_id = m.company_id AND d.id = m.finance_reference_id
          AND d.external_source_type = ${inventorySource} AND d.external_source_id = m.id::text AND d.collaborator_id = m.collaborator_id))
      OR (m.finance_reference_type = 'PRODUCT_SALE' AND (m.finance_reference_id <> m.id OR m.movement_type <> 'SALE_OUT'))
    )
    UNION ALL
    SELECT 'origens financeiras do estoque', count(*)::integer FROM (
      SELECT id, company_id, external_source_id, 'EXPENSE' AS kind FROM expenses WHERE external_source_type = ${inventorySource}
      UNION ALL
      SELECT id, company_id, external_source_id, 'COMMISSION_DEDUCTION' FROM commission_deductions WHERE external_source_type = ${inventorySource}
    ) f WHERE f.company_id = ${companyId} AND NOT EXISTS (
      SELECT 1 FROM inventory_movements m WHERE m.company_id = f.company_id AND m.id::text = f.external_source_id
        AND m.finance_reference_type = f.kind AND m.finance_reference_id = f.id)
    UNION ALL
    SELECT 'atores financeiros', count(*)::integer FROM (
      SELECT company_id, recorded_by AS actor FROM receipts
      UNION ALL SELECT company_id, recorded_by FROM commission_settlements
      UNION ALL SELECT company_id, commission_paid_by FROM financial_documents
    ) f WHERE f.company_id = ${companyId} AND f.actor IS NOT NULL AND f.actor <> f.company_id
      AND NOT EXISTS (SELECT 1 FROM collaborators c WHERE c.id = f.actor AND c.company_id = f.company_id)
  `);
  const result = await tx.execute<{ relation: string; orphans: number }>(sql.join(checks, sql` union all `));
  const invalid = result.rows.filter(({ orphans }) => orphans > 0);
  if (invalid.length) throw new Error(`Registros órfãos: ${JSON.stringify(invalid)}`);
  return { orphans: 0, relationsChecked: result.rows.length };
}

function statuses(completed: number, canceled: number, noShow: number): AppointmentStatusValue[] {
  const result: AppointmentStatusValue[] = Array.from({ length: completed }, () => "COMPLETED");
  for (let index = 0; index < canceled; index++) result.splice(4 + index * 7, 0, "CANCELED");
  for (let index = 0; index < noShow; index++) result.splice(8 + index * 11, 0, "NO_SHOW");
  return result;
}

async function main() {
  config({ quiet: true });
  if (process.env.NODE_ENV === "production") throw new Error("Seed de demonstração bloqueado em produção.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL deve apontar para o PostgreSQL de desenvolvimento.");
  const args = process.argv.slice(2);
  const email = args[0]?.match(/^--company-email=([^\s]+@[^\s]+)$/)?.[1]?.toLowerCase();
  if (args.length > 1 || (args.length === 1 && !email)) throw new Error("Uso: npm run seed:demo -- --company-email=<email>");

  const { db } = await import("../database.js");
  try {
    const result = await db.transaction(async (tx) => {
      const rowSignature = sql<string>`md5(row_to_json(companies)::text)`;
      const [row] = await tx.select({ company: CompanyTable, signature: rowSignature, now: sql<string>`now()::text` }).from(CompanyTable)
        .where(email ? sql`lower(${CompanyTable.email}) = ${email}` : eq(CompanyTable.isActive, true))
        .orderBy(asc(CompanyTable.createdAt), asc(CompanyTable.id)).limit(1).for("update");
      if (!row) throw new Error(email ? "Empresa não encontrada para o e-mail informado." : "Nenhuma empresa ativa encontrada.");
      const { company, signature } = row;
      const companyId = company.id;
      const now = new Date(row.now);
      const dates = calendar(company, now);
      const id = demoId(companyId);
      const hours = weeklyHours(company);
      const blocks = await tx.select({ startsAt: ScheduleBlockTable.startsAt, endsAt: ScheduleBlockTable.endsAt })
        .from(ScheduleBlockTable).where(and(eq(ScheduleBlockTable.companyId, companyId), isNull(ScheduleBlockTable.collaboratorId)));
      const periods = {
        previous: planAppointments(company, id, hours, blocks, { key: "previous", from: dates.previousStart, to: dates.previousEnd, past: true, statuses: statuses(25, 3, 2) }, dates.asOf),
        current: planAppointments(company, id, hours, blocks, { key: "current", from: dates.currentStart, to: dates.today, past: true, statuses: statuses(20, 2, 1) }, dates.asOf),
        future: planAppointments(company, id, hours, blocks, { key: "future", from: changeDay(dates.today, 1), to: dates.currentEnd, past: false,
          statuses: Array.from({ length: 10 }, (_, index) => index % 3 === 2 ? "PENDING" : "CONFIRMED") }, dates.asOf),
      };
      const [priorDemo] = await tx.select({ password: CollaboratorTable.password }).from(CollaboratorTable)
        .where(and(eq(CollaboratorTable.companyId, companyId), eq(CollaboratorTable.id, id("staff:0")),
          eq(CollaboratorTable.email, `demo-${companyId}-1@example.invalid`)));
      const password = priorDemo?.password ?? await bcrypt.hash(randomBytes(32).toString("hex"), 10);
      await protectOtherCompanies(tx, companyId);
      await clearOperationalData(tx, companyId);
      await seedTeam(tx, company, id, hours, dates.instant(dates.previousStart, 0), password);
      const appointments = Object.values(periods).flatMap((rows) => rows.map(({ appointment }) => appointment));
      if (appointments.length) await tx.insert(AppointmentTable).values(appointments);
      await seedExpenses(tx, companyId, id, dates, company.currency);
      const withdrawal = await seedInventory(tx, company, id, dates);
      await seedCollections(tx, company, id, dates, periods, withdrawal);

      const [preserved] = await tx.select({ signature: rowSignature }).from(CompanyTable).where(eq(CompanyTable.id, companyId));
      if (preserved?.signature !== signature) throw new Error("A linha da empresa foi alterada durante o seed.");
      const integrity = await verifyOrphans(tx, companyId);
      const summary = Object.fromEntries(Object.entries(periods).map(([period, rows]) => {
        const totals: Record<string, number> = {};
        for (const { appointment } of rows) totals[appointment.status!] = (totals[appointment.status!] ?? 0) + 1;
        return [period, totals];
      }));
      return { companyName: company.companyName, companyId, timezone: company.timezone, date: dates.today, appointments: summary, ...integrity };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  // Drizzle query errors can contain SQL parameters. Report the database error without dumping them.
  const detail = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  console.error(detail instanceof Error ? detail.message : detail);
  process.exitCode = 1;
});
