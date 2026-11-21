import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "./collaborators-schema.js";

/**
 * Tabela de jornada semanal individual do colaborador (collaborator_schedules).
 * Controla os turnos de trabalho de cada dia da semana (0 a 6) e intervalos de pausa.
 */
export const CollaboratorScheduleTable = pgTable(
  "collaborator_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "cascade" }),
    dayOfWeek: smallint("day_of_week").notNull(),
    isWorkingDay: boolean("is_working_day").notNull().default(false),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    breakStartTime: varchar("break_start_time", { length: 5 }),
    breakEndTime: varchar("break_end_time", { length: 5 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "collaborator_schedules_day_chk",
      sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`,
    ),
    uniqueIndex("collaborator_schedules_company_collab_day_uidx").on(
      table.companyId,
      table.collaboratorId,
      table.dayOfWeek,
    ),
    index("collaborator_schedules_collab_idx").on(table.companyId, table.collaboratorId),
  ],
);
