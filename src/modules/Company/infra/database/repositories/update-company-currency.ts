import { and, eq } from "drizzle-orm";
import type { db } from "../../../../../shared/database/database.js";
import { CollectionsError } from "../../../../finance/domain/collections.js";
import { FinancialDocumentTable, ReceiptTable } from "../../../../finance/infra/database/schema/collections-schema.js";
import { CommissionDeductionTable, ExpenseTable } from "../../../../finance/infra/database/schema/outflows-schema.js";
import { InventoryMovementTable } from "../../../../inventory/infra/database/schema/inventory-schema.js";
import { CompanyTable } from "../schema/companies-schema.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Currency = (typeof CompanyTable.$inferSelect)["currency"];

export async function updateCompanyCurrency(tx: Transaction, companyId: string, currency: Currency) {
  const [company] = await tx.select({ currency: CompanyTable.currency }).from(CompanyTable)
    .where(eq(CompanyTable.id, companyId)).for("update");
  if (!company) throw new CollectionsError("NOT_FOUND", "FINANCE_RECORD_NOT_FOUND");
  if (company.currency === currency) return company;
  const [receipt] = await tx.select({ id: ReceiptTable.id }).from(ReceiptTable)
    .where(eq(ReceiptTable.companyId, companyId)).limit(1);
  const [expense] = await tx.select({ id: ExpenseTable.id }).from(ExpenseTable)
    .where(eq(ExpenseTable.companyId, companyId)).limit(1);
  const [deduction] = await tx.select({ id: CommissionDeductionTable.id }).from(CommissionDeductionTable)
    .where(eq(CommissionDeductionTable.companyId, companyId)).limit(1);
  const [sale] = await tx.select({ id: InventoryMovementTable.id }).from(InventoryMovementTable).where(and(
    eq(InventoryMovementTable.companyId, companyId), eq(InventoryMovementTable.movementType, "SALE_OUT"),
  )).limit(1);
  if (receipt || expense || deduction || sale) throw new CollectionsError("CONFLICT", "FINANCE_CURRENCY_LOCKED");
  await tx.update(FinancialDocumentTable).set({ currency })
    .where(eq(FinancialDocumentTable.companyId, companyId));
  await tx.update(CompanyTable).set({ currency, monthlyGoalCurrency: currency, updatedAt: new Date() })
    .where(eq(CompanyTable.id, companyId));
  return { currency };
}
