import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import { ServiceTable } from "../../../../services/infra/database/schema/services-schema.js";

import type { BookingClientData } from "../../../domain/repositories/appointments.repository.js";

export const AppointmentTable = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id")
      .notNull()
      .references(() => CollaboratorTable.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => ServiceTable.id, { onDelete: "restrict" }),
    clientName: text("client_name").notNull(),
    clientPhone: text("client_phone").notNull(),
    clientData: jsonb("client_data").$type<BookingClientData>(),
    cancellationDigest: text("cancellation_digest"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    cancellationReason: text("cancellation_reason"),
    notes: text("notes"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // Preserve the booked service; the commission rate is refreshed when the professional changes.
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    servicePriceInCentsSnapshot: integer(
      "service_price_in_cents_snapshot",
    ).notNull(),
    serviceDurationMinutesSnapshot: integer(
      "service_duration_minutes_snapshot",
    ).notNull(),
    commissionPercentageSnapshot: numeric("commission_percentage_snapshot", {
      precision: 5,
      scale: 2,
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("appointments_company_id_unique").on(table.companyId, table.id),
    check(
      "appointments_time_range_chk",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "appointments_duration_positive_chk",
      sql`${table.serviceDurationMinutesSnapshot} > 0`,
    ),
    check(
      "appointments_price_non_negative_chk",
      sql`${table.servicePriceInCentsSnapshot} >= 0`,
    ),
    check(
      "appointments_commission_range_chk",
      sql`${table.commissionPercentageSnapshot} >= 0 AND ${table.commissionPercentageSnapshot} <= 100`,
    ),
    check(
      "appointments_status_chk",
      sql`${table.status} IN ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW')`,
    ),
    index("appointments_company_collab_range_idx").on(
      table.companyId,
      table.collaboratorId,
      table.startsAt,
      table.endsAt,
    ),
    index("appointments_company_starts_at_idx").on(
      table.companyId,
      table.startsAt,
    ),
    index("appointments_company_status_starts_at_idx").on(
      table.companyId,
      table.status,
      table.startsAt,
    ),
  ],
);
