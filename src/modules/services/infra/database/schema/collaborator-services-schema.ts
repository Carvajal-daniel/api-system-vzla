import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { ServiceTable } from "./services-schema.js";

export const CollaboratorServiceTable = pgTable(
  "collaborator_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => ServiceTable.id, { onDelete: "cascade" }),
    commissionPercentage: numeric("commission_percentage", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "collaborator_services_commission_range_chk",
      sql`${table.commissionPercentage} >= 0 AND ${table.commissionPercentage} <= 100`,
    ),
    uniqueIndex("collaborator_services_company_collab_service_uidx").on(
      table.companyId,
      table.collaboratorId,
      table.serviceId,
    ),
    index("collaborator_services_company_service_idx").on(table.companyId, table.serviceId),
    index("collaborator_services_company_collab_idx").on(table.companyId, table.collaboratorId),
  ],
);
