import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
import { CompanyTable } from "./companies-schema.js";
import { AppointmentTable } from "../../../../appointments/infra/database/schema/appointments-schema.js";

const mode = z.enum(["required", "optional", "hidden"]);
export const publicClientFields = z.object({ birthDate: mode, document: mode, email: mode, gender: mode, source: mode });
export const privateClientFieldKeys = new Set(["clientAddress","clientNumber","clientComplement","clientDistrict","clientCity","clientState","clientPostalCode","hairType","pigmentation","hairLength","elasticity","porosity","volume","strandThickness","resistance","allergies","allergyNotes","medication","soughtDoctor","diagnosis","pathology","pathologyNotes","currentTreatments","observations"]);
const customId = z.string().regex(/^custom_[a-zA-Z0-9_-]{1,48}$/);
const registrationKeys = ["email", "birthDate", "document"] as const;
const slotKey = z.string().max(56).refine((key) => registrationKeys.some((id) => id === key) ||
  privateClientFieldKeys.has(key) || customId.safeParse(key).success, "Campo de cliente desconhecido.");
const clientFieldSlots = z.array(slotKey.nullable()).min(4).max(32).refine((slots) => {
  const selected = slots.filter(Boolean);
  return new Set(selected).size === selected.length;
}, "Selecione cada campo apenas uma vez.");
const placeId = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
const clientFields = publicClientFields.catchall(mode);
const mapsUrl = z.string().trim().max(2048).url().refine((raw) => {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return url.protocol === "https:" && !url.username && !url.password &&
    (url.hostname === "maps.app.goo.gl" || (url.hostname === "goo.gl" && url.pathname.startsWith("/maps/")) ||
      /^(?:www\.|maps\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(url.hostname) &&
      (url.hostname.startsWith("maps.") || /^\/maps(?:\/|$)/.test(url.pathname)));
}, "Informe um link HTTPS do Google Maps.");
const onlinePayment = z.object({
  enabled: z.boolean(), depositPercentage: z.number().int().min(0).max(100),
  pixKeyType: z.enum(["CNPJ", "EMAIL", "PHONE", "EVP"]), pixKey: z.string().trim().max(160),
  autoRefundHours: z.number().int().min(0).max(720), noShowPolicy: z.string().trim().max(1000),
});
const reminders = z.object({
  enabled: z.boolean(), hours: z.literal([1, 2, 4, 24]),
  template: z.enum(["buttons", "plain", "whatsapp", "external", "custom"]),
  servicePhone: z.string().regex(/^\+[1-9]\d{9,14}$/).or(z.literal("")).optional(),
  message: z.string().max(1500), externalUrl: z.string().max(2048).refine((value) => !value || /^https:\/\/[^\s]+$/i.test(value)),
}).refine((value) => !value.enabled || (value.template !== "custom" || !!value.message) &&
  (value.template !== "external" || !!value.externalUrl), "Complete o modelo de lembrete.");
const customClientFields = z.array(z.object({
  id: customId, label: z.string().trim().min(1).max(80), mode,
})).max(25).refine((fields) => new Set(fields.map((field) => field.id)).size === fields.length);
const addressLine = z.string().trim().max(120);
const brazilianAddress = z.object({
  postalCode: addressLine.optional(), zipCode: addressLine.optional(),
  street: addressLine.min(1), number: addressLine, district: addressLine, city: addressLine.min(1), state: addressLine,
}).transform(({ postalCode, zipCode, ...address }) => ({ ...address, postalCode: postalCode ?? zipCode ?? "" }));
const venezuelanAddress = z.object({
  state: addressLine.min(1), city: addressLine.min(1), sector: addressLine.default(""),
  addressLine: addressLine.min(1), referencePoint: addressLine.default(""),
});
export const settingsSchema = z.object({
  countryCode: z.enum(["BR", "VE"]).default("BR"),
  documents: z.object({
    countryCode: z.enum(["BR", "VE"]).optional(),
    personalDoc: z.string().trim().max(32).optional(),
    businessDoc: z.string().trim().max(32).optional(),
  }).optional(),
  description: z.string().max(1000).optional(),
  address: z.union([venezuelanAddress, brazilianAddress]).nullable(),
  agendaInterval: z.literal([5, 10, 15, 30, 60]),
  bookingInterval: z.literal([0, 15, 20, 30, 60]),
  leadTime: z.literal([0, 30, 60, 120, 1440]),
  maxAdvanceBookingDays: z.number().int().min(1).nullable().default(null),
  allowClientCancel: z.boolean().default(true),
  cancelLeadTime: z.number().int().min(0).optional(),
  allowClientConfirm: z.boolean().default(true),
  allowClientReschedule: z.boolean().default(true),
  maxActiveBookingsPerClient: z.number().int().min(1).nullable().default(null),
  newBookingCancelsPrevious: z.boolean().default(false),
  clientFields,
  clientFieldSlots: clientFieldSlots.nullable(),
  googlePlaceId: placeId.nullable(),
  birthdayRadar: z.boolean(),
  surveyEnabled: z.boolean(),
  googleMapsUrl: mapsUrl.nullable(),
  googleRating: z.number().min(1).max(5).nullable(),
  googleReviewsCount: z.number().int().min(0).max(100000000).nullable(),
  reminders: reminders.nullable(),
  onlinePayment: onlinePayment.nullable(),
  packageSales: z.object({ enabled: z.boolean(), notes: z.string().trim().max(1000) }).nullable(),
  customClientFields,
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaults: Settings = {
  countryCode: "BR", address: null, agendaInterval: 30, bookingInterval: 0, leadTime: 0,
  maxAdvanceBookingDays: null, allowClientCancel: true, allowClientConfirm: true, allowClientReschedule: true,
  maxActiveBookingsPerClient: null, newBookingCancelsPrevious: false,
  clientFields: { birthDate: "optional", document: "optional", email: "optional", gender: "optional", source: "optional" },
  birthdayRadar: false, surveyEnabled: false,
  googleMapsUrl: null, googleRating: null, googleReviewsCount: null, googlePlaceId: null, clientFieldSlots: null,
  reminders: null, onlinePayment: null, packageSales: null, customClientFields: [],
};

const legacyPalettes: Readonly<Record<string, string>> = {
  cobalt: "royal", rose: "ruby", velvet: "violet", obsidian: "matte", petrol: "teal",
};
export const appearanceSchema = z.object({
  mode: z.enum(["light", "dark"]),
  locale: z.enum(["pt-BR", "es"]),
  palette: z.preprocess((value) => typeof value === "string" && Object.hasOwn(legacyPalettes, value) ? legacyPalettes[value] : value,
    z.enum(["royal", "ruby", "emerald", "violet", "matte", "cyan", "gold", "terracotta", "teal", "indigo", "graphite"])),
});

const clientFieldsPatch = publicClientFields.partial().catchall(mode).refine((fields) =>
  Object.keys(fields).every((key) => Object.hasOwn(publicClientFields.shape, key) || privateClientFieldKeys.has(key)),
  "Campo de cliente desconhecido.",
);
export const settingsPatchSchema = settingsSchema.partial().extend({
  countryCode: settingsSchema.shape.countryCode.removeDefault().optional(),
  maxAdvanceBookingDays: settingsSchema.shape.maxAdvanceBookingDays.removeDefault().optional(),
  allowClientCancel: settingsSchema.shape.allowClientCancel.removeDefault().optional(),
  allowClientConfirm: settingsSchema.shape.allowClientConfirm.removeDefault().optional(),
  allowClientReschedule: settingsSchema.shape.allowClientReschedule.removeDefault().optional(),
  maxActiveBookingsPerClient: settingsSchema.shape.maxActiveBookingsPerClient.removeDefault().optional(),
  newBookingCancelsPrevious: settingsSchema.shape.newBookingCancelsPrevious.removeDefault().optional(),
  clientFields: clientFieldsPatch.optional(),
  reminders: reminders.refine((value) =>
    (value.template !== "whatsapp" || !!value.servicePhone) && (value.template !== "external" || !!value.externalUrl),
    "Complete o telefone de atendimento ou o link do modelo.").nullable().optional(),
});

export function selectedClientFields(preferences: z.infer<typeof settingsPatchSchema> | null | undefined) {
  const modes = preferences?.clientFields;
  const custom = preferences?.customClientFields ?? [];
  const supported = [...registrationKeys, ...privateClientFieldKeys, ...custom.map(({ id }) => id)];
  const slots = preferences?.clientFieldSlots ?? supported.filter((key) =>
    (modes?.[key] ?? custom.find(({ id }) => id === key)?.mode) === "required");
  return slots.flatMap((key) => {
    if (!key || !supported.includes(key)) return [];
    const current = modes?.[key] ?? custom.find(({ id }) => id === key)?.mode;
    return [{ id: key, mode: current === "required" ? "required" as const : "optional" as const }];
  });
}

export const CompanySettingsTable = pgTable("company_settings", {
  companyId: uuid("company_id").primaryKey().references(() => CompanyTable.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").$type<z.infer<typeof settingsPatchSchema>>().default({}).notNull(),
  appearance: jsonb("appearance").$type<z.infer<typeof appearanceSchema>>(),
});

export const ClientProfileFieldsTable = pgTable("client_profile_fields", {
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  values: jsonb("values").$type<Record<string, string>>().notNull(),
}, (table) => [primaryKey({ columns: [table.companyId, table.clientId] })]);

export const SurveyTable = pgTable("company_surveys", {
  appointmentId: uuid("appointment_id").primaryKey().references(() => AppointmentTable.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => CompanyTable.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
});

