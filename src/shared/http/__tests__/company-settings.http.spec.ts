import { drizzle } from "drizzle-orm/node-postgres";
import fastify from "fastify";
import { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsPatchSchema } from "../../../modules/Company/infra/database/schema/company-settings-schema.js";
import { companySettingsRoutes } from "../../../modules/Company/infra/http/company-settings.routes.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../database/database.js", () => ({ db: drizzle({ client: Object.assign(new Pool(), { query }) }) }));

const companyId = "26e23a0f-9b29-4f4f-a438-cf235ba2aa29";
const appointmentId = "5c72ea20-a640-42b8-9c08-b9a78ea950b1";
const now = new Date("2026-11-23T12:00:00Z");

describe("public appointment cancellation", () => {
  afterEach(() => {
    vi.useRealTimers();
    query.mockReset();
  });

  it.each([
    { until: 61, cancelLeadTime: 60, status: 204 },
    { until: 60, cancelLeadTime: 60, status: 409 },
    { until: 59, cancelLeadTime: 60, status: 409 },
    { until: 119, cancelLeadTime: undefined, status: 409 },
    { until: 1, cancelLeadTime: 0, status: 204 },
    { until: 61, cancelLeadTime: 60, allowClientCancel: false, status: 403 },
  ])("returns $status when the appointment starts in $until minutes", async ({ until, cancelLeadTime, status, ...preferences }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const startsAt = new Date(now.getTime() + until * 60_000);
    const effectiveLeadTime = cancelLeadTime ?? 120;
    let updated = false;
    query.mockImplementation(async ({ text }: { text: string }, params: unknown[]) => {
      if (text.startsWith('select "status"')) return { rows: [["CONFIRMED"]] };
      if (text.startsWith('select "preferences"')) return { rows: [[{ leadTime: 120, cancelLeadTime, ...preferences }]] };
      if (text.startsWith('select "phone"')) return { rows: [["+5511999999999", "America/Sao_Paulo"]] };
      expect(text).toMatch(/"appointments"\."starts_at" > \$\d+/);
      const threshold = new Date(String(params.at(-1)));
      expect(threshold).toEqual(new Date(now.getTime() + effectiveLeadTime * 60_000));
      updated = startsAt > threshold;
      return { rows: updated ? [[appointmentId]] : [] };
    });

    const app = fastify();
    await app.register(companySettingsRoutes);
    try {
      const response = await app.inject({ method: "POST",
        url: `/public/companies/${companyId}/appointments/${appointmentId}/cancel`,
        payload: { token: "a".repeat(43) },
      });
      expect(response.statusCode).toBe(status);
      expect(updated).toBe(status === 204);
      if (status !== 204) expect(response.json()).toMatchObject({ cancelLeadTime: effectiveLeadTime, whatsapp: "+5511999999999" });
    } finally {
      await app.close();
    }
  });
});

describe("company regional settings", () => {
  afterEach(() => query.mockReset());

  it("accepts legacy postalCode and normalizes zipCode", () => {
    const address = { street: "Rua da Matriz", number: "42", district: "Centro", city: "Recife", state: "PE" };
    expect(settingsPatchSchema.parse({ address: { ...address, zipCode: "50000000" } }).address)
      .toEqual({ ...address, postalCode: "50000000" });
    expect(settingsPatchSchema.parse({ address: { ...address, postalCode: "50000000" } }).address)
      .toEqual({ ...address, postalCode: "50000000" });
  });

  it("validates country and description without defaulting country in unrelated patches", () => {
    expect(settingsPatchSchema.parse({ agendaInterval: 15 })).toEqual({ agendaInterval: 15 });
    expect(settingsPatchSchema.safeParse({ countryCode: "US" }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ description: "a".repeat(1000) }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ description: "a".repeat(1001) }).success).toBe(false);
  });

  it("returns the Venezuelan address and description without exposing company documents", async () => {
    const address = { state: "Miranda", city: "Chacao", sector: "Altamira", addressLine: "Av. principal", referencePoint: "Frente a la plaza" };
    const description = "Barberia en Altamira.";
    const documents = { countryCode: "VE", personalDoc: "V-12.345.678", businessDoc: "J-12345678-9" };
    query.mockImplementation(async ({ text }: { text: string }) => {
      if (text.startsWith('select "id"')) return { rows: [[companyId]] };
      if (text.startsWith('select "preferences"')) return { rows: [[{ address, description, documents, countryCode: "VE" }]] };
      if (text.startsWith('select count(')) return { rows: [["0", null]] };
      throw new Error("Unexpected company settings query");
    });

    const app = fastify();
    await app.register(companySettingsRoutes);
    try {
      const response = await app.inject({ method: "GET", url: `/public/companies/${companyId}/settings` });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ countryCode: "VE", address, description });
      expect(response.json()).not.toHaveProperty("documents");
      expect(response.json()).not.toHaveProperty("countryCodeConfigured");
    } finally {
      await app.close();
    }
  });
});
