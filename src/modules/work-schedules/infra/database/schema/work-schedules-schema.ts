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
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const WorkScheduleTable = pgTable(
  "work_schedules",
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
    breakStart: varchar("break_start", { length: 5 }),
    breakEnd: varchar("break_end", { length: 5 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("work_schedules_day_of_week_chk", sql`${table.dayOfWeek} >= 0 AND ${table.dayOfWeek} <= 6`),
    check(
      "work_schedules_working_hours_chk",
      sql`(${table.isWorkingDay} = false AND ${table.startTime} IS NULL AND ${table.endTime} IS NULL AND ${table.breakStart} IS NULL AND ${table.breakEnd} IS NULL) OR (${table.isWorkingDay} = true AND ${table.startTime} IS NOT NULL AND ${table.endTime} IS NOT NULL AND ${table.endTime} > ${table.startTime})`,
    ),
    check(
      "work_schedules_break_hours_chk",
      sql`(${table.breakStart} IS NULL AND ${table.breakEnd} IS NULL) OR (${table.breakStart} IS NOT NULL AND ${table.breakEnd} IS NOT NULL AND ${table.breakStart} > ${table.startTime} AND ${table.breakEnd} > ${table.breakStart} AND ${table.breakEnd} < ${table.endTime})`,
    ),
    uniqueIndex("work_schedules_company_collab_day_uidx").on(
      table.companyId,
      table.collaboratorId,
      table.dayOfWeek,
    ),
    index("work_schedules_company_collab_idx").on(table.companyId, table.collaboratorId),
  ],
);
