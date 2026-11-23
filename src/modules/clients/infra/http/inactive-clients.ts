import { eq, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { CompanySettingsTable } from "../../../Company/infra/database/schema/company-settings-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";

const dayMs = 86_400_000;

export async function recoveryCompany(companyId: string) {
  const [company] = await db
    .select({
      name: CompanyTable.companyName,
      appearance: CompanySettingsTable.appearance,
      preferences: CompanySettingsTable.preferences,
    })
    .from(CompanyTable)
    .leftJoin(CompanySettingsTable, eq(CompanySettingsTable.companyId, CompanyTable.id))
    .where(eq(CompanyTable.id, companyId));
  const country = company?.preferences?.countryCode ?? "BR";
  return {
    name: company?.name ?? "",
    country,
    locale: (company?.appearance?.locale ?? (country === "VE" ? "es" : "pt-BR")) as "pt-BR" | "es",
  };
}

type ClientRow = {
  id: string;
  name: string;
  phone: string;
  service_name: string;
  price: number;
  collaborator_name: string;
  completed_at: string;
  stars: number | null;
  comment: string | null;
  review_created_at: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  canceled_last: boolean;
  total_visits: number;
  avg_interval_days: number | null;
  recent_cancellations: number;
  recent_no_shows: number;
  changed_collaborator: boolean;
  previous_price: number | null;
};

export interface InactiveClientRecord {
  id: string;
  name: string;
  phone: string;
  lastVisit: {
    serviceName: string;
    price: number;
    collaboratorName: string;
    completedAt: string;
    daysSinceLastVisit: number;
  };
  lastReview: {
    stars: number;
    comment: string | null;
    createdAt: string;
  } | null;
  lastCancellation: {
    canceledAt: string;
    cancelReason: string | null;
  } | null;
  historySummary: {
    totalVisits: number;
    averageVisitIntervalDays: number | null;
    recentCancellations: number;
    recentNoShows: number;
    changedCollaborator: boolean;
    priceDeltaPercent: number | null;
  };
  diagnosticTag: "LOW_RATING" | "CANCELED_WITHOUT_REBOOK" | "CHURN_INACTIVE";
}

export async function inactiveClients(
  companyId: string,
  country: "BR" | "VE",
  inactiveDays: number,
  clientId?: string,
  now = new Date(),
): Promise<InactiveClientRecord[]> {
  const cutoff = new Date(now.getTime() - inactiveDays * dayMs).toISOString();
  const recentCancellation = new Date(now.getTime() - 90 * dayMs).toISOString();
  const nowIso = now.toISOString();
  const result = await db.execute<ClientRow>(sql`
    WITH contacts AS (
      SELECT a.*, regexp_replace(a.client_phone, '[^0-9]', '', 'g') AS digits
      FROM appointments a
      WHERE a.company_id = ${companyId}
    ), normalized AS (
      SELECT contacts.*, CASE
        WHEN client_phone LIKE '+%' AND length(digits) BETWEEN 8 AND 15 THEN digits
        WHEN ${country} = 'VE' AND digits ~ '^0[24][0-9]{9}$' THEN '58' || substr(digits, 2)
        WHEN length(digits) > 11 AND length(digits) <= 15 THEN digits
        WHEN length(digits) BETWEEN 8 AND 11 THEN (CASE WHEN ${country} = 'VE' THEN '58' ELSE '55' END) || digits
        ELSE NULL END AS phone_number
      FROM contacts
    ), history AS (
      SELECT normalized.*,
        'c_' || coalesce(phone_number, 'name_' || lower(regexp_replace(trim(client_name), '[[:space:]]+', ' ', 'g'))) AS client_key
      FROM normalized
    ), completed_ranked AS (
      SELECT
        history.*,
        coalesce(completed_at, ends_at) AS done_at,
        ROW_NUMBER() OVER (PARTITION BY client_key ORDER BY coalesce(completed_at, ends_at) DESC, id DESC) AS rn
      FROM history
      WHERE status = 'COMPLETED'
        AND (${clientId ?? null}::text IS NULL OR client_key = ${clientId ?? null})
    ), visits AS (
      SELECT *, done_at AS last_completed_at
      FROM completed_ranked
      WHERE rn = 1
    ), visit_stats AS (
      SELECT
        client_key,
        COUNT(*)::int AS total_visits,
        CASE
          WHEN COUNT(*) >= 2 THEN
            ROUND(EXTRACT(EPOCH FROM (MAX(done_at) - MIN(done_at))) / 86400.0 / (COUNT(*) - 1))::int
          ELSE NULL
        END AS avg_interval_days,
        MAX(CASE WHEN rn = 2 THEN collaborator_id::text END) AS prev_collaborator_id,
        MAX(CASE WHEN rn = 2 THEN service_price_in_cents_snapshot END) AS previous_price
      FROM completed_ranked
      GROUP BY client_key
    ), recent_events AS (
      SELECT
        client_key,
        COUNT(*) FILTER (WHERE status = 'CANCELED' AND updated_at >= ${recentCancellation}::timestamptz)::int AS recent_cancellations,
        COUNT(*) FILTER (WHERE status = 'NO_SHOW' AND updated_at >= ${recentCancellation}::timestamptz)::int AS recent_no_shows
      FROM history
      GROUP BY client_key
    )
    SELECT visit.client_key AS id, visit.client_name AS name, coalesce('+' || visit.phone_number, visit.client_phone) AS phone,
      visit.service_name_snapshot AS service_name, visit.service_price_in_cents_snapshot AS price, staff.name AS collaborator_name,
      visit.last_completed_at AS completed_at, review.rating AS stars, review.comment, review.created_at AS review_created_at,
      CASE WHEN cancellation.updated_at >= ${recentCancellation}::timestamptz THEN cancellation.updated_at END AS canceled_at,
      CASE WHEN cancellation.updated_at >= ${recentCancellation}::timestamptz THEN cancellation.cancellation_reason END AS cancel_reason,
      coalesce(cancellation.updated_at > visit.last_completed_at AND NOT EXISTS (
        SELECT 1 FROM history later WHERE later.client_key = visit.client_key
          AND later.status = 'NO_SHOW' AND later.updated_at > cancellation.updated_at
      ), false) AS canceled_last,
      coalesce(stats.total_visits, 1) AS total_visits,
      stats.avg_interval_days,
      coalesce(ev.recent_cancellations, 0) AS recent_cancellations,
      coalesce(ev.recent_no_shows, 0) AS recent_no_shows,
      coalesce(stats.prev_collaborator_id IS NOT NULL AND stats.prev_collaborator_id <> visit.collaborator_id::text, false) AS changed_collaborator,
      stats.previous_price
    FROM visits visit
    INNER JOIN collaborators staff ON staff.id = visit.collaborator_id AND staff.company_id = ${companyId}
    LEFT JOIN visit_stats stats ON stats.client_key = visit.client_key
    LEFT JOIN recent_events ev ON ev.client_key = visit.client_key
    LEFT JOIN LATERAL (
      SELECT r.rating, r.comment, r.created_at FROM collaborator_reviews r
      LEFT JOIN history reviewed ON reviewed.id = r.appointment_id
      WHERE r.company_id = ${companyId} AND r.rating BETWEEN 1 AND 5 AND (
        reviewed.client_key = visit.client_key OR (r.appointment_id IS NULL
          AND r.client_id IN (visit.client_key, 'c_' || visit.digits))
      )
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1
    ) review ON true
    LEFT JOIN LATERAL (
      SELECT updated_at, cancellation_reason FROM history
      WHERE client_key = visit.client_key AND status = 'CANCELED'
      ORDER BY updated_at DESC, id DESC LIMIT 1
    ) cancellation ON true
    WHERE visit.last_completed_at < ${cutoff}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM history upcoming WHERE upcoming.client_key = visit.client_key
          AND upcoming.status IN ('PENDING', 'CONFIRMED') AND upcoming.starts_at >= ${nowIso}::timestamptz
      )
    ORDER BY visit.last_completed_at, visit.client_key
  `);

  return result.rows.map((row) => {
    const priceDeltaPercent =
      row.previous_price && row.previous_price > 0 && row.price !== row.previous_price
        ? Math.round(((row.price - row.previous_price) / row.previous_price) * 100)
        : null;

    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      lastVisit: {
        serviceName: row.service_name,
        price: row.price,
        collaboratorName: row.collaborator_name,
        completedAt: new Date(row.completed_at).toISOString(),
        daysSinceLastVisit: Math.floor((now.getTime() - Date.parse(row.completed_at)) / dayMs),
      },
      lastReview:
        row.stars === null
          ? null
          : {
              stars: row.stars,
              comment: row.comment,
              createdAt: row.review_created_at
                ? new Date(row.review_created_at).toISOString()
                : new Date(row.completed_at).toISOString(),
            },
      lastCancellation: row.canceled_at
        ? {
            canceledAt: new Date(row.canceled_at).toISOString(),
            cancelReason: row.cancel_reason,
          }
        : null,
      historySummary: {
        totalVisits: Number(row.total_visits ?? 1),
        averageVisitIntervalDays:
          row.avg_interval_days === null ? null : Number(row.avg_interval_days),
        recentCancellations: Number(row.recent_cancellations ?? 0),
        recentNoShows: Number(row.recent_no_shows ?? 0),
        changedCollaborator: Boolean(row.changed_collaborator),
        priceDeltaPercent,
      },
      diagnosticTag:
        row.stars !== null && row.stars <= 3
          ? ("LOW_RATING" as const)
          : row.canceled_last
            ? ("CANCELED_WITHOUT_REBOOK" as const)
            : ("CHURN_INACTIVE" as const),
    };
  });
}
