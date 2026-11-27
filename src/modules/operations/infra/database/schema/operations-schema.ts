import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";
import { ClientTable } from "../../../../clients/infra/database/schema/clients-schema.js";
import { CollaboratorTable } from "../../../../Collaborators/infra/database/schema/collaborators-schema.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";

export const WAITLIST_SHIFTS = ["MORNING", "AFTERNOON", "EVENING", "ANY"] as const;
export type WaitlistShift = (typeof WAITLIST_SHIFTS)[number];

export const WAITLIST_STATUSES = ["WAITING", "NOTIFIED", "CONVERTED", "EXPIRED"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const POST_VISIT_SURVEY_STATUSES = [
  "PENDING_SEND",
  "SENT",
  "ANSWERED",
  "ESCALATED_TO_OWNER",
] as const;
export type PostVisitSurveyStatus = (typeof POST_VISIT_SURVEY_STATUSES)[number];

export const OWNER_ALERT_TYPES = [
  "LOW_SURVEY_SCORE",
  "COLLABORATOR_EMERGENCY",
  "CHURN_OPPORTUNITY",
  "AI_HANDOFF",
] as const;
export type OwnerAlertType = (typeof OWNER_ALERT_TYPES)[number];

// Fila de espera inteligente por data, turno e profissional opcional (isolada por empresa).
export const WaitlistEntryTable = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => ClientTable.id, { onDelete: "cascade" }),
    collaboratorId: uuid("collaborator_id").references(() => CollaboratorTable.id, {
      onDelete: "set null",
    }),
    desiredDate: date("desired_date", { mode: "string" }).notNull(),
    preferredShift: varchar("preferred_shift", { length: 16, enum: WAITLIST_SHIFTS })
      .notNull()
      .default("ANY"),
    status: varchar("status", { length: 16, enum: WAITLIST_STATUSES })
      .notNull()
      .default("WAITING"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("waitlist_entries_company_date_status_idx").on(
      table.companyId,
      table.desiredDate,
      table.status,
      table.createdAt,
    ),
    index("waitlist_entries_status_expires_idx").on(table.status, table.expiresAt),
    check(
      "waitlist_entries_shift_check",
      sql`${table.preferredShift} in ('MORNING', 'AFTERNOON', 'EVENING', 'ANY')`,
    ),
    check(
      "waitlist_entries_status_check",
      sql`${table.status} in ('WAITING', 'NOTIFIED', 'CONVERTED', 'EXPIRED')`,
    ),
  ],
);

// Pesquisa de satisfação pós-atendimento em 2 passos (agendada 2h após fechamento de comanda).
export const PostVisitSurveyTable = pgTable(
  "post_visit_surveys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => AppointmentTable.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => ClientTable.id, { onDelete: "cascade" }),
    score: integer("score"),
    feedbackText: text("feedback_text"),
    status: varchar("status", { length: 24, enum: POST_VISIT_SURVEY_STATUSES })
      .notNull()
      .default("PENDING_SEND"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).defaultNow().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("post_visit_surveys_appointment_unique").on(table.appointmentId),
    index("post_visit_surveys_company_status_scheduled_idx").on(
      table.companyId,
      table.status,
      table.scheduledFor,
    ),
    index("post_visit_surveys_company_client_status_idx").on(
      table.companyId,
      table.clientId,
      table.status,
      table.sentAt,
    ),
    check(
      "post_visit_surveys_score_check",
      sql`${table.score} is null or (${table.score} >= 1 and ${table.score} <= 5)`,
    ),
    check(
      "post_visit_surveys_status_check",
      sql`${table.status} in ('PENDING_SEND', 'SENT', 'ANSWERED', 'ESCALATED_TO_OWNER')`,
    ),
  ],
);

// Alertas operacionais e de retenção direcionados ao dono da barbearia/salão.
export const OwnerAlertTable = pgTable(
  "owner_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => CompanyTable.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32, enum: OWNER_ALERT_TYPES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    isRead: boolean("is_read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("owner_alerts_company_read_created_idx").on(
      table.companyId,
      table.isRead,
      table.createdAt,
    ),
    check(
      "owner_alerts_type_check",
      sql`${table.type} in ('LOW_SURVEY_SCORE', 'COLLABORATOR_EMERGENCY', 'CHURN_OPPORTUNITY', 'AI_HANDOFF')`,
    ),
  ],
);
