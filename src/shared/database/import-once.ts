import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CollectionsError } from "../../modules/finance/domain/collections.js";
import { ImportBatchTable } from "../../modules/inventory/infra/database/schema/inventory-schema.js";
import type { db } from "./database.js";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The caller holds the company row lock until the batch and its imported records are committed.
export async function importOnce(tx: Transaction, companyId: string, kind: "EXPENSES" | "INVENTORY",
  key: string, payload: unknown, insert: () => Promise<number>) {
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const [existing] = await tx.select().from(ImportBatchTable).where(and(
    eq(ImportBatchTable.companyId, companyId), eq(ImportBatchTable.kind, kind), eq(ImportBatchTable.requestKey, key),
  ));
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new CollectionsError("CONFLICT", "FINANCE_IDEMPOTENCY_CONFLICT");
    return { imported: existing.imported };
  }
  const imported = await insert();
  await tx.insert(ImportBatchTable).values({ companyId, kind, requestKey: key, fingerprint, imported });
  return { imported };
}
