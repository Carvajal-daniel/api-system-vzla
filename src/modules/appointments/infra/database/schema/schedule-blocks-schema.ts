import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const ScheduleBlockTable = pgTable(
  "schedule_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    // NULL indica bloqueio global para toda a empresa (ex.: feriado ou manutenção).
    collaboratorId: uuid("collaborator_id").references(
      () => CollaboratorTable.id,
      { onDelete: "cascade" },
    ),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "schedule_blocks_time_range_chk",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    index("schedule_blocks_company_range_idx").on(
      table.companyId,
      table.startsAt,
      table.endsAt,
    ),
    index("schedule_blocks_company_collab_range_idx").on(
      table.companyId,
      table.collaboratorId,
      table.startsAt,
      table.endsAt,
    ),
  ],
);
