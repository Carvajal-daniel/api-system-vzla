import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getGoogleMapsApiKey } from "../../../../shared/config/env.js";
import { db } from "../../../../shared/database/database.js";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { CompanySettingsTable } from "../database/schema/company-settings-schema.js";
import { CompanyTable } from "../database/schema/companies-schema.js";

const placeId = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const params = z.object({ companyId: z.uuid() });
const text = z.object({ text: z.string().optional() });
const https = z.url({ protocol: /^https$/ });
const placeSchema = z.object({
  id: placeId, displayName: text.optional(), formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  rating: z.number().min(1).max(5).optional(), userRatingCount: z.number().int().nonnegative().optional(),
  googleMapsUri: https.optional(),
  reviews: z.array(z.object({
    rating: z.number().optional(), text: text.optional(), relativePublishTimeDescription: z.string().optional(),
    googleMapsUri: https.optional(),
    authorAttribution: z.object({ displayName: z.string().optional(), uri: https.optional() }).optional(),
  })).optional(),
});
const summaryFields = ["id", "displayName", "formattedAddress", "location", "rating", "userRatingCount", "googleMapsUri"];
const searchFields = ["id", "displayName", "formattedAddress", "googleMapsUri"];

function publicPlace(place: z.infer<typeof placeSchema>) {
  return {
    id: place.id, name: place.displayName?.text ?? "", address: place.formattedAddress ?? "",
    coordinates: place.location ?? null, rating: place.rating ?? null, reviewsCount: place.userRatingCount ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    reviews: (place.reviews ?? []).map((review) => ({
      rating: review.rating ?? null, text: review.text?.text ?? "", published: review.relativePublishTimeDescription ?? "",
      url: review.googleMapsUri ?? null, author: review.authorAttribution?.displayName ?? "", authorUrl: review.authorAttribution?.uri ?? null,
    })),
  };
}

async function requestGoogle(key: string, path: string, fields: string[], body?: { textQuery: string; pageSize: number }) {
  return fetch(`https://places.googleapis.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields.join(","), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(6_000),
  }).catch(() => null);
}

async function details(key: string, id: string, summary: boolean) {
  const response = await requestGoogle(key, `places/${encodeURIComponent(id)}`, summary ? summaryFields : [...summaryFields, "reviews"]);
  if (response?.status === 404) return { status: "not_found" as const };
  if (!response?.ok) return { status: "unavailable" as const };
  const place = placeSchema.safeParse(await response.json().catch(() => null));
  return place.success ? { status: "ready" as const, place: publicPlace(place.data) } : { status: "unavailable" as const };
}

const missingKey = { status: "not_configured", message: "Configure GOOGLE_MAPS_API_KEY no .env do backend." } as const;

export async function googlePlaceRoutes(app: FastifyInstance) {
  app.get("/companies/:companyId/google-place/search", { preHandler: [authenticate, authorizeRoles("OWNER")] }, async (request, reply) => {
    const { companyId } = params.parse(request.params);
    if (request.actor!.companyId !== companyId) return reply.code(403).send({ message: "Acesso restrito à própria empresa." });
    const { query } = z.object({ query: z.string().trim().min(3).max(255) }).parse(request.query);
    reply.header("Cache-Control", "no-store");
    const key = getGoogleMapsApiKey();
    if (!key) return missingKey;
    const candidate = query.startsWith("places/") ? query.slice(7) : /^(?:ChIJ|GhIJ)[A-Za-z0-9_-]+$/.test(query) ? query : null;
    if (candidate) {
      const result = await details(key, placeId.parse(candidate), false);
      return result.status === "ready" ? { status: "ready", places: [result.place] } : result;
    }
    const response = await requestGoogle(key, "places:searchText", searchFields.map((field) => `places.${field}`), { textQuery: query, pageSize: 7 });
    if (!response?.ok) return { status: "unavailable" };
    const result = z.object({ places: z.array(placeSchema).default([]) }).safeParse(await response.json().catch(() => null));
    return result.success ? { status: "ready", places: result.data.places.map(publicPlace) } : { status: "unavailable" };
  });

  app.get("/companies/:companyId/google-place", async (request, reply) => {
    const { companyId } = params.parse(request.params);
    const { summary } = z.object({ summary: z.enum(["true", "false"]).optional() }).parse(request.query);
    const [row] = await db.select({ settings: CompanySettingsTable.preferences }).from(CompanyTable)
      .leftJoin(CompanySettingsTable, eq(CompanySettingsTable.companyId, CompanyTable.id))
      .where(and(eq(CompanyTable.id, companyId), eq(CompanyTable.isActive, true)));
    if (!row) return reply.code(404).send({ message: "Empresa não encontrada." });
    reply.header("Cache-Control", "no-store");
    const key = getGoogleMapsApiKey();
    if (!key) return missingKey;
    const id = row.settings?.googlePlaceId;
    if (!id) return { status: "not_linked" };
    return details(key, id, summary === "true");
  });
}
