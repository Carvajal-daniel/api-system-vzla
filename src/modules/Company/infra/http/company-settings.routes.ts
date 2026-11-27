import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { and, avg, between, count, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { analyzeSatisfaction } from "../../domain/satisfaction-analysis.js";
import {
  isValidCompanySlug,
  normalizeCustomCompanySlug,
  RESERVED_COMPANY_SLUGS,
} from "../../domain/slug.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../../../shared/database/database.js";
import { authenticate, authorizeRoles } from "../../../../shared/http/auth/authenticate.js";
import { timezoneSchema } from "../../../../shared/utils/validation-schemas.js";
import { updateCompanyCurrency } from "../database/repositories/update-company-currency.js";
import { CompanyTable } from "../database/schema/companies-schema.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { CollaboratorReviewTable } from "../../../Collaborators/infra/database/schema/collaborator-reviews-schema.js";
import { appearanceSchema, ClientProfileFieldsTable, CompanySettingsTable, defaults, publicClientFields, selectedClientFields, settingsPatchSchema, settingsSchema, SurveyTable, type Settings } from "../database/schema/company-settings-schema.js";

async function readSettingsSnapshot(companyId: string) {
  const [row] = await db.select({ preferences: CompanySettingsTable.preferences }).from(CompanySettingsTable)
    .where(eq(CompanySettingsTable.companyId, companyId));
  const preferences = row?.preferences;
  return {
    settings: settingsSchema.parse({ ...defaults, ...preferences, clientFields: { ...defaults.clientFields, ...preferences?.clientFields } }),
    countryCodeConfigured: preferences?.countryCode !== undefined,
  };
}

async function readCompanySettings(companyId: string): Promise<Settings> {
  return (await readSettingsSnapshot(companyId)).settings;
}

async function snapshot(companyId: string) {
  const [{ settings, countryCodeConfigured }, [rating], [companyRow]] = await Promise.all([
    readSettingsSnapshot(companyId),
    db.select({ count: count(CollaboratorReviewTable.rating), average: avg(CollaboratorReviewTable.rating) })
      .from(CollaboratorReviewTable).where(and(eq(CollaboratorReviewTable.companyId, companyId), between(CollaboratorReviewTable.rating, 1, 5))),
    db.select({
      slug: CompanyTable.slug,
      googleReviewUrl: CompanyTable.googleReviewUrl,
      enablePostVisitSurvey: CompanyTable.enablePostVisitSurvey,
    }).from(CompanyTable).where(eq(CompanyTable.id, companyId)).limit(1),
  ]);
  return {
    ...settings,
    slug: companyRow?.slug ?? null,
    countryCodeConfigured,
    googleReviewUrl: companyRow?.googleReviewUrl ?? null,
    enablePostVisitSurvey: companyRow?.enablePostVisitSurvey ?? true,
    rating: rating?.count ? { count: rating.count, average: Number(rating.average) } : null,
  };
}

const owner = { preHandler: [authenticate, authorizeRoles("OWNER")] };
const requestReview = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() });

async function surveyReviews(companyId: string, limit: number, stars?: number) {
  return db.select({
    id: CollaboratorReviewTable.id, appointmentId: CollaboratorReviewTable.appointmentId,
    stars: CollaboratorReviewTable.rating, comment: CollaboratorReviewTable.comment,
    submittedAt: CollaboratorReviewTable.createdAt, service: CollaboratorReviewTable.serviceName,
  }).from(CollaboratorReviewTable)
    .where(and(eq(CollaboratorReviewTable.companyId, companyId),
      stars === undefined ? between(CollaboratorReviewTable.rating, 1, 5) : eq(CollaboratorReviewTable.rating, stars)))
    .orderBy(desc(CollaboratorReviewTable.createdAt), desc(CollaboratorReviewTable.id)).limit(limit);
}

export async function companySettingsRoutes(app: FastifyInstance) {
  // Rota pública leve para redirecionar URLs legadas /book/[companyId] para /[slug]
  app.get(
    "/public/companies/:companyId/slug",
    {
      schema: {
        tags: ["Public Portal"],
        summary: "Resolve the public booking portal slug from a legacy companyId",
        params: {
          type: "object",
          required: ["companyId"],
          properties: { companyId: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            required: ["slug"],
            properties: { slug: { type: "string" } },
          },
          400: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
          404: {
            type: "object",
            required: ["message"],
            properties: { message: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const { companyId } = z.object({ companyId: z.uuid() }).parse(request.params);
      const [company] = await db
        .select({ slug: CompanyTable.slug })
        .from(CompanyTable)
        .where(and(eq(CompanyTable.id, companyId), eq(CompanyTable.isActive, true)))
        .limit(1);
      if (!company) return reply.code(404).send({ message: "Empresa não encontrada." });
      return { slug: company.slug };
    },
  );

  app.get("/public/companies/:companyId/settings", async (request, reply) => {
    const { companyId } = z.object({ companyId: z.uuid() }).parse(request.params);
    const [company] = await db.select({ id: CompanyTable.id }).from(CompanyTable)
      .where(and(eq(CompanyTable.id, companyId), eq(CompanyTable.isActive, true)));
    if (!company) return reply.code(404).send({ message: "Empresa não encontrada." });
    const { reminders: _reminders, onlinePayment: _payment, packageSales: _packages, documents: _documents, countryCodeConfigured: _countryCodeConfigured, customClientFields, clientFields, ...publicSettings } = await snapshot(companyId);
    const active = selectedClientFields({ clientFields, customClientFields, clientFieldSlots: publicSettings.clientFieldSlots });
    const ids = new Set(active.map(({ id }) => id));
    return { ...publicSettings, cancelLeadTime: publicSettings.cancelLeadTime ?? publicSettings.leadTime, clientFields: { ...publicClientFields.parse(clientFields), ...Object.fromEntries(active.map(({ id, mode }) => [id, mode])) },
      customClientFields: customClientFields.filter(({ id }) => ids.has(id)) };

  });

  app.get("/companies/me/settings", owner, (request) => snapshot(request.actor!.companyId));

  async function patchSettings(request: FastifyRequest, reply: FastifyReply) {
    const companyId = request.actor!.companyId;
    const { companyId: target } = z.object({ companyId: z.uuid().optional() }).parse(request.params ?? {});
    if (target && target !== companyId) return reply.code(403).send({ message: "Acesso restrito à própria empresa." });
    const body = settingsPatchSchema.extend({
      slug: z.string().trim().min(2).max(120).optional(),
      appearance: appearanceSchema.partial().optional(), palette: appearanceSchema.shape.palette.optional(),
      mode: appearanceSchema.shape.mode.optional(), theme: appearanceSchema.shape.mode.optional(),
      region: z.object({ timezone: timezoneSchema, currency: z.enum(["BRL", "USD", "VES"]) }).optional(),
      googleReviewUrl: z.string().trim().url().max(500).nullable().optional(),
      enablePostVisitSurvey: z.boolean().optional(),
    }).parse(request.body);
    const { slug: rawSlug, appearance: nested, palette, mode, theme, region, googleReviewUrl, enablePostVisitSurvey, ...preferences } = body;
    const companyColumnUpdates: Partial<typeof CompanyTable.$inferInsert> = {};
    if (googleReviewUrl !== undefined) companyColumnUpdates.googleReviewUrl = googleReviewUrl;
    if (enablePostVisitSurvey !== undefined) companyColumnUpdates.enablePostVisitSurvey = enablePostVisitSurvey;
    if (rawSlug !== undefined) {
      const normalizedSlug = normalizeCustomCompanySlug(rawSlug);
      if (RESERVED_COMPANY_SLUGS.has(normalizedSlug)) {
        return reply.code(400).send({
          code: "COMPANY_SLUG_RESERVED",
          message: "Este link personalizado é reservado pelo sistema. Escolha outro nome.",
        });
      }
      if (!isValidCompanySlug(normalizedSlug)) {
        return reply.code(400).send({
          code: "COMPANY_SLUG_INVALID",
          message: "Informe um link válido com pelo menos 2 caracteres (letras, números e hífen).",
        });
      }
      const [conflict] = await db
        .select({ id: CompanyTable.id })
        .from(CompanyTable)
        .where(and(eq(CompanyTable.slug, normalizedSlug), ne(CompanyTable.id, companyId)))
        .limit(1);
      if (conflict) {
        return reply.code(409).send({
          code: "COMPANY_SLUG_ALREADY_IN_USE",
          message: "Este link personalizado já está em uso por outro estabelecimento.",
        });
      }
      companyColumnUpdates.slug = normalizedSlug;
    }
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
    const writePreferences = (query: Pick<typeof db, "insert">) => query.insert(CompanySettingsTable).values({ companyId, preferences, ...(hasAppearance ? { appearance: initialAppearance } : {}) })
      .onConflictDoUpdate({
        target: CompanySettingsTable.companyId,
        set: {
          preferences: mergedPreferences,
          ...(hasAppearance ? { appearance: sql`coalesce(${CompanySettingsTable.appearance}, '{}'::jsonb) || ${JSON.stringify(appearance)}::jsonb` } : {}),
        },
      });
    try {
      if (region) {
        await db.transaction(async (tx) => {
          await updateCompanyCurrency(tx, companyId, region.currency);
          await tx.update(CompanyTable).set({ timezone: region.timezone, ...companyColumnUpdates, updatedAt: new Date() })
            .where(eq(CompanyTable.id, companyId));
          await writePreferences(tx);
        });
      } else {
        if (Object.keys(companyColumnUpdates).length > 0) {
          await db.update(CompanyTable).set({ ...companyColumnUpdates, updatedAt: new Date() })
            .where(eq(CompanyTable.id, companyId));
        }
        await writePreferences(db);
      }
    } catch (error) {
      const pgCode = typeof error === "object" && error !== null
        ? ((error as { code?: string; cause?: { code?: string } }).code ??
          (error as { cause?: { code?: string } }).cause?.code)
        : undefined;
      if (pgCode === "23505" && companyColumnUpdates.slug) {
        return reply.code(409).send({
          code: "COMPANY_SLUG_ALREADY_IN_USE",
          message: "Este link personalizado já está em uso por outro estabelecimento.",
        });
      }
      throw error;
    }
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
    const preferences = await readCompanySettings(companyId);
    const effectiveCancelLeadTime = preferences.cancelLeadTime ?? preferences.leadTime ?? 0;
    async function rejection(status: 403 | 409, code: string, message: string) {
      const [company] = await db.select({ phone: CompanyTable.phone, timezone: CompanyTable.timezone })
        .from(CompanyTable).where(eq(CompanyTable.id, companyId));
      return reply.code(status).send({
        code, message, cancelLeadTime: effectiveCancelLeadTime,
        whatsapp: preferences.reminders?.servicePhone || company?.phone,
        timezone: company?.timezone,
      });
    }
    if (preferences.allowClientCancel === false) {
      return rejection(403, "PUBLIC_CANCEL_DISABLED", "O cancelamento por este link está desativado.");
    }
    const [updated] = await db.update(AppointmentTable)
      .set({ status: "CANCELED", cancellationReason: "Cancelado pelo cliente", updatedAt: new Date() })
      .where(and(match, inArray(AppointmentTable.status, ["PENDING", "CONFIRMED"]),
        gt(AppointmentTable.startsAt, new Date(Date.now() + effectiveCancelLeadTime * 60_000))))
      .returning({ id: AppointmentTable.id });
    if (!updated) return rejection(409, "PUBLIC_CANCEL_CONFLICT", "Esta reserva não pode mais ser cancelada por este link.");
    return reply.code(204).send();
  });

  app.get("/companies/me/reviews", owner, (request) => {
    const { stars, limit } = z.object({
      stars: z.coerce.number().int().min(1).max(5).optional(),
      limit: z.coerce.number().int().positive().default(100),
    }).parse(request.query);
    return surveyReviews(request.actor!.companyId, limit, stars);
  });

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

  // Consulta se o PIN de autorização do dono já está configurado na empresa (sem nunca expor o hash)
  app.get("/companies/me/security/pin", {
    ...owner,
    schema: {
      tags: ["Company Security (Owner)"],
      summary: "Check whether the company owner authorization PIN is configured",
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: "object",
          properties: { hasPin: { type: "boolean" } },
        },
      },
    },
  }, async (request) => {
    const companyId = request.actor!.companyId;
    const [company] = await db
      .select({ ownerPinHash: CompanyTable.ownerPinHash })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId));
    return { hasPin: Boolean(company?.ownerPinHash) };
  });

  // Configura ou altera o PIN numérico (4 a 6 dígitos) do dono mediante validação da senha atual
  app.patch("/companies/me/security/pin", {
    ...owner,
    schema: {
      tags: ["Company Security (Owner)"],
      summary: "Set or update the company owner authorization PIN (4 to 6 numeric digits)",
      security: [{ bearerAuth: [] }],
      body: {
        type: "object",
        required: ["currentPassword", "pin"],
        properties: {
          currentPassword: { type: "string", minLength: 1 },
          pin: { type: "string", pattern: "^[0-9]{4,6}$" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: { hasPin: { type: "boolean" } },
        },
        401: { type: "object", properties: { message: { type: "string" } } },
        404: { type: "object", properties: { message: { type: "string" } } },
      },
    },
  }, async (request, reply) => {
    const companyId = request.actor!.companyId;
    const { currentPassword, pin } = z
      .object({
        currentPassword: z.string().min(1, "OWNER_CURRENT_PASSWORD_REQUIRED"),
        pin: z.string().regex(/^\d{4,6}$/, "OWNER_PIN_INVALID_FORMAT"),
      })
      .parse(request.body);

    const [company] = await db
      .select({ id: CompanyTable.id, password: CompanyTable.password })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId));

    if (!company) {
      return reply.code(404).send({ message: "COMPANY_NOT_FOUND" });
    }

    const passwordMatches = await bcrypt.compare(currentPassword, company.password);
    if (!passwordMatches) {
      return reply.code(401).send({ message: "INVALID_CURRENT_PASSWORD" });
    }

    const ownerPinHash = await bcrypt.hash(pin, 10);
    await db
      .update(CompanyTable)
      .set({ ownerPinHash, updatedAt: new Date() })
      .where(eq(CompanyTable.id, companyId));

    return { hasPin: true };
  });
}
