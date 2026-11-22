import { createHash, randomBytes } from "node:crypto";
import { and, avg, between, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { analyzeSatisfaction } from "../../domain/satisfaction-analysis.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../../../shared/database/database.js";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { CompanyTable } from "../database/schema/companies-schema.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorReviewTable } from "../../../Collaborators/infra/database/schema/collaborator-reviews-schema.js";
import { appearanceSchema, ClientProfileFieldsTable, CompanySettingsTable, defaults, publicClientFields, selectedClientFields, settingsPatchSchema, settingsSchema, SurveyTable, type Settings } from "../database/schema/company-settings-schema.js";

async function readCompanySettings(companyId: string): Promise<Settings> {
  const [row] = await db.select({ preferences: CompanySettingsTable.preferences }).from(CompanySettingsTable)
    .where(eq(CompanySettingsTable.companyId, companyId));
  return settingsSchema.parse({ ...defaults, ...row?.preferences, clientFields: { ...defaults.clientFields, ...row?.preferences.clientFields } });
}

async function snapshot(companyId: string) {
  const [settings, [rating]] = await Promise.all([
    readCompanySettings(companyId),
    db.select({ count: count(CollaboratorReviewTable.rating), average: avg(CollaboratorReviewTable.rating) })
      .from(CollaboratorReviewTable).where(and(eq(CollaboratorReviewTable.companyId, companyId), between(CollaboratorReviewTable.rating, 1, 5))),
  ]);
  return { ...settings, rating: rating?.count ? { count: rating.count, average: Number(rating.average) } : null };
}

const owner = { preHandler: [authenticate, authorizeRoles("OWNER")] };
const requestReview = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() });

async function surveyReviews(companyId: string, limit: number) {
  return db.select({
    id: CollaboratorReviewTable.id, appointmentId: CollaboratorReviewTable.appointmentId,
    stars: CollaboratorReviewTable.rating, comment: CollaboratorReviewTable.comment,
    submittedAt: CollaboratorReviewTable.createdAt, service: CollaboratorReviewTable.serviceName,
  }).from(CollaboratorReviewTable)
    .where(and(eq(CollaboratorReviewTable.companyId, companyId), between(CollaboratorReviewTable.rating, 1, 5)))
    .orderBy(desc(CollaboratorReviewTable.createdAt)).limit(limit);
}

export async function companySettingsRoutes(app: FastifyInstance) {
  app.get("/public/companies/:companyId/settings", async (request, reply) => {
    const { companyId } = z.object({ companyId: z.uuid() }).parse(request.params);
    const [company] = await db.select({ id: CompanyTable.id }).from(CompanyTable)
      .where(and(eq(CompanyTable.id, companyId), eq(CompanyTable.isActive, true)));
    if (!company) return reply.code(404).send({ message: "Empresa não encontrada." });
    const { reminders: _reminders, onlinePayment: _payment, packageSales: _packages, customClientFields, clientFields, ...publicSettings } = await snapshot(companyId);
    const active = selectedClientFields({ clientFields, customClientFields, clientFieldSlots: publicSettings.clientFieldSlots });
    const ids = new Set(active.map(({ id }) => id));
    return { ...publicSettings, clientFields: { ...publicClientFields.parse(clientFields), ...Object.fromEntries(active.map(({ id, mode }) => [id, mode])) },
      customClientFields: customClientFields.filter(({ id }) => ids.has(id)) };

  });

  app.get("/companies/me/settings", owner, (request) => snapshot(request.actor!.companyId));

  async function patchSettings(request: FastifyRequest, reply: FastifyReply) {
    const companyId = request.actor!.companyId;
    const { companyId: target } = z.object({ companyId: z.uuid().optional() }).parse(request.params ?? {});
    if (target && target !== companyId) return reply.code(403).send({ message: "Acesso restrito à própria empresa." });
    const body = settingsPatchSchema.extend({
      appearance: appearanceSchema.partial().optional(), palette: appearanceSchema.shape.palette.optional(),
      mode: appearanceSchema.shape.mode.optional(), theme: appearanceSchema.shape.mode.optional(),
    }).parse(request.body);
    const { appearance: nested, palette, mode, theme, ...preferences } = body;
    const appearance = {
      ...nested,
      ...(palette ? { palette } : {}),
      ...(mode ?? theme ? { mode: mode ?? theme } : {}),
    };
    const hasAppearance = Object.keys(appearance).length > 0;
    const initialAppearance = appearanceSchema.parse({ mode: "light", locale: "pt-BR", palette: "royal", ...appearance });
    const combined = sql`${CompanySettingsTable.preferences} || excluded.preferences`;
    const mergedPreferences = preferences.clientFields ? sql`jsonb_set(${combined}, '{clientFields}',
      coalesce(${CompanySettingsTable.preferences}->'clientFields', '{}'::jsonb) || (excluded.preferences->'clientFields'))` : combined;
    await db.insert(CompanySettingsTable).values({ companyId, preferences, ...(hasAppearance ? { appearance: initialAppearance } : {}) })
      .onConflictDoUpdate({
        target: CompanySettingsTable.companyId,
        set: {
          preferences: mergedPreferences,
          ...(hasAppearance ? { appearance: sql`coalesce(${CompanySettingsTable.appearance}, '{}'::jsonb) || ${JSON.stringify(appearance)}::jsonb` } : {}),
        },
      });
    return snapshot(companyId);
  }
  app.patch("/companies/me/settings", owner, patchSettings);
  app.patch("/companies/:companyId/settings", owner, patchSettings);
  app.patch("/companies/:companyId", owner, patchSettings);

  app.get("/companies/me/settings/appearance", owner, async (request) => {
    const [row] = await db.select({ appearance: CompanySettingsTable.appearance }).from(CompanySettingsTable)
      .where(eq(CompanySettingsTable.companyId, request.actor!.companyId));
    return { appearance: row?.appearance ? appearanceSchema.parse(Object.assign({ mode: "light", locale: "pt-BR", palette: "royal" }, row.appearance)) : null };
  });

  app.patch("/companies/me/settings/appearance", owner, async (request) => {
    const companyId = request.actor!.companyId;
    const appearance = appearanceSchema.parse(request.body);
    await db.insert(CompanySettingsTable).values({ companyId, appearance })
      .onConflictDoUpdate({ target: CompanySettingsTable.companyId, set: { appearance } });
    return { appearance };
  });

  const clientParams = z.object({ clientId: z.string().min(1).max(240) });
  app.get("/companies/me/client-profiles/:clientId", owner, async (request) => {
    const { clientId } = clientParams.parse(request.params);
    const [row] = await db.select({ values: ClientProfileFieldsTable.values }).from(ClientProfileFieldsTable)
      .where(and(eq(ClientProfileFieldsTable.companyId, request.actor!.companyId), eq(ClientProfileFieldsTable.clientId, clientId)));
    const active = selectedClientFields(await readCompanySettings(request.actor!.companyId));
    return { values: Object.fromEntries(active.flatMap(({ id }) => row?.values[id] !== undefined ? [[id, row.values[id]]] : [])) };
  });

  app.patch("/companies/me/client-profiles/:clientId", owner, async (request, reply) => {
    const { clientId } = clientParams.parse(request.params);
    const companyId = request.actor!.companyId;
    const { values } = z.object({ values: z.record(z.string().max(60), z.string().trim().max(2500)) }).parse(request.body);
    const settings = await readCompanySettings(companyId);
    const editable = new Map(selectedClientFields(settings).map(({ id, mode }) => [id, mode]));
    for (const [key, mode] of editable) {
      if (mode === "required" && !values[key]) return reply.code(400).send({ message: "Preencha os campos obrigatórios da ficha." });
    }
    const filtered = Object.fromEntries(Object.entries(values).filter(([key]) => editable.has(key)));
    const [row] = await db.insert(ClientProfileFieldsTable).values({ companyId, clientId, values: filtered })
      .onConflictDoUpdate({
        target: [ClientProfileFieldsTable.companyId, ClientProfileFieldsTable.clientId],
        set: { values: sql`${ClientProfileFieldsTable.values} || excluded.values` },
      }).returning({ values: ClientProfileFieldsTable.values });
    return { values: Object.fromEntries(Object.entries(row?.values ?? filtered).filter(([key]) => editable.has(key))) };
  });

  app.get("/companies/me/client-booking-data", owner, (request) =>
    db.select({ phone: AppointmentTable.clientPhone, details: AppointmentTable.clientData })
      .from(AppointmentTable).where(and(eq(AppointmentTable.companyId, request.actor!.companyId),
        sql`${AppointmentTable.clientData} <> '{}'::jsonb`)).orderBy(desc(AppointmentTable.createdAt)),
  );

  app.post("/public/companies/:companyId/appointments/:appointmentId/cancel", async (request, reply) => {
    const { companyId, appointmentId } = z.object({ companyId: z.uuid(), appointmentId: z.uuid() }).parse(request.params);
    const { token } = z.object({ token: z.string().regex(/^[\w-]{43}$/) }).parse(request.body);
    const digest = createHash("sha256").update(token).digest("hex");
    const match = and(eq(AppointmentTable.id, appointmentId), eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.cancellationDigest, digest));
    const [appointment] = await db.select({ status: AppointmentTable.status }).from(AppointmentTable).where(match);
    if (!appointment) return reply.code(404).send({ message: "Reserva não encontrada." });
    if (appointment.status === "CANCELED") return reply.code(204).send();
    const { leadTime } = await readCompanySettings(companyId);
    const [updated] = await db.update(AppointmentTable)
      .set({ status: "CANCELED", cancellationReason: "Cancelado pelo cliente", updatedAt: new Date() })
      .where(and(match, inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
        gt(AppointmentTable.startsAt, new Date(Date.now() + leadTime * 60_000))))
      .returning({ id: AppointmentTable.id });
    if (!updated) return reply.code(409).send({ message: "Esta reserva está fora do prazo de cancelamento." });
    return reply.code(204).send();
  });

  app.get("/companies/me/reviews", owner, (request) => surveyReviews(request.actor!.companyId, 100));

  app.post("/companies/me/reviews/:appointmentId", owner, async (request, reply) => {
    const companyId = request.actor!.companyId;
    const { appointmentId } = z.object({ appointmentId: z.uuid() }).parse(request.params);
    if (!(await readCompanySettings(companyId)).surveyEnabled) return reply.code(409).send({ message: "Ative a pesquisa de satisfação." });
    const [appointment] = await db.select({ id: AppointmentTable.id }).from(AppointmentTable)
      .where(and(eq(AppointmentTable.id, appointmentId), eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.status, "COMPLETED")));
    if (!appointment) return reply.code(404).send({ message: "Atendimento concluído não encontrado." });
    const [review] = await db.select({ id: CollaboratorReviewTable.id }).from(CollaboratorReviewTable)
      .where(and(eq(CollaboratorReviewTable.companyId, companyId), eq(CollaboratorReviewTable.appointmentId, appointmentId))).limit(1);
    if (review) return reply.code(409).send({ message: "Este atendimento já foi avaliado." });
    const newToken = randomBytes(32).toString("base64url");
    await db.insert(SurveyTable).values({ companyId, appointmentId, token: newToken }).onConflictDoNothing();
    const [survey] = await db.select({ token: SurveyTable.token }).from(SurveyTable).where(eq(SurveyTable.appointmentId, appointmentId));
    return { token: survey!.token };
  });

  app.post("/public/reviews/:token", async (request, reply) => {
    const { token } = z.object({ token: z.string().regex(/^[\w-]{43}$/) }).parse(request.params);
    const review = requestReview.parse(request.body);
    const [row] = await db.select({ companyId: SurveyTable.companyId }).from(SurveyTable).where(eq(SurveyTable.token, token));
    if (!row || !(await readCompanySettings(row.companyId)).surveyEnabled) {
      return reply.code(404).send({ message: "Pesquisa indisponível." });
    }
    const submitted = await db.transaction(async (tx) => {
      const now = new Date();
      const [updated] = await tx.update(SurveyTable).set({ submittedAt: now })
        .where(and(eq(SurveyTable.token, token), isNull(SurveyTable.submittedAt)))
        .returning({ appointmentId: SurveyTable.appointmentId });
      if (!updated) return false;
      const [appointment] = await tx.select({
        collaboratorId: AppointmentTable.collaboratorId, clientName: AppointmentTable.clientName,
        serviceName: AppointmentTable.serviceNameSnapshot,
      }).from(AppointmentTable).where(and(eq(AppointmentTable.id, updated.appointmentId), eq(AppointmentTable.companyId, row.companyId)));
      if (!appointment) return false;
      const [existing] = await tx.select({ id: CollaboratorReviewTable.id }).from(CollaboratorReviewTable)
        .where(and(eq(CollaboratorReviewTable.companyId, row.companyId), eq(CollaboratorReviewTable.appointmentId, updated.appointmentId))).limit(1);
      if (existing) return false;
      await tx.insert(CollaboratorReviewTable).values({
        ...appointment,
        companyId: row.companyId,
        appointmentId: updated.appointmentId,
        rating: review.stars,
        comment: review.comment ?? null,
        createdAt: now,
      });
      return true;
    });
    if (!submitted) return reply.code(409).send({ message: "Este atendimento já foi avaliado." });
    return reply.code(204).send();
  });

  app.post("/companies/me/reviews/analysis", owner, async (request, reply) => {
    const companyId = request.actor!.companyId;
    const { locale } = z.object({ locale: z.enum(["pt-BR", "es"]) }).parse(request.body);
    const [reviews, settings] = await Promise.all([surveyReviews(companyId, 100), snapshot(companyId)]);
    if (!settings.rating) return reply.code(409).send({ message: "Ainda não há avaliações para analisar." });
    return analyzeSatisfaction(settings.rating, reviews, locale);
  });
}
