import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getJwtSecret } from "../../../shared/config/env.js";
import { db } from "../../../shared/database/database.js";
import { registerErrorHandler } from "../../../shared/http/error-handler.js";
import {
  resetActorStatusVerifier,
  setActorStatusVerifier,
} from "../../../shared/http/auth/authenticate.js";
import { CompanyTable } from "../../Company/infra/database/schema/companies-schema.js";
import { financeRoutes } from "../../finance/infra/http/routes/finance.routes.js";
import { adminRoutes } from "../infra/http/admin.routes.js";

describe("Executive Dashboard & Super-Admin HTTP routes", () => {
  let adminCompanyId: string;
  let normalCompanyId: string;
  let adminToken: string;
  let normalToken: string;
  let collabToken: string;
  const adminEmail = `superadmin-${randomUUID().slice(0, 8)}@platform.test`;
  const normalEmail = `owner-${randomUUID().slice(0, 8)}@barber.test`;

  beforeAll(async () => {
    setActorStatusVerifier(async () => true);
    adminCompanyId = randomUUID();
    normalCompanyId = randomUUID();

    await db.insert(CompanyTable).values([
      {
        id: adminCompanyId,
        companyName: "Plataforma HQ",
        slug: `hq-${adminCompanyId.slice(0, 8)}`,
        name: "Super Admin",
        phone: "+5511999990001",
        email: adminEmail,
        password: "hashed-password",
        timezone: "America/Sao_Paulo",
        currency: "BRL",
        saasPlan: "SCALE",
        saasStatus: "ACTIVE",
      },
      {
        id: normalCompanyId,
        companyName: "Barbearia Regular",
        slug: `reg-${normalCompanyId.slice(0, 8)}`,
        name: "Dono Comum",
        phone: "+5511999990002",
        email: normalEmail,
        password: "hashed-password",
        timezone: "America/Sao_Paulo",
        currency: "BRL",
        saasPlan: "PRO",
        saasStatus: "TRIAL",
      },
    ]);

    adminToken = jwt.sign(
      { sub: adminCompanyId, companyId: adminCompanyId, role: "OWNER" },
      getJwtSecret(),
      { expiresIn: "1h" },
    );
    normalToken = jwt.sign(
      { sub: normalCompanyId, companyId: normalCompanyId, role: "OWNER" },
      getJwtSecret(),
      { expiresIn: "1h" },
    );
    collabToken = jwt.sign(
      { sub: randomUUID(), companyId: normalCompanyId, role: "COLLABORATOR" },
      getJwtSecret(),
      { expiresIn: "1h" },
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    await db.delete(CompanyTable).where(eq(CompanyTable.id, adminCompanyId));
    await db.delete(CompanyTable).where(eq(CompanyTable.id, normalCompanyId));
  });

  async function buildApp() {
    const app = Fastify();
    registerErrorHandler(app);
    await app.register(financeRoutes);
    await app.register(adminRoutes);
    await app.ready();
    return app;
  }

  it("returns structured KPIs on GET /finance/executive-dashboard for OWNER and forbids COLLABORATOR", async () => {
    const app = await buildApp();

    const forbidden = await app.inject({
      method: "GET",
      url: "/finance/executive-dashboard",
      headers: { authorization: `Bearer ${collabToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: "GET",
      url: "/finance/executive-dashboard?from=2026-11-01&to=2026-11-30",
      headers: { authorization: `Bearer ${normalToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      period: { from: "2026-11-01", to: "2026-11-30", timezone: "America/Sao_Paulo" },
      currency: "BRL",
      revenueSplit: {
        avulsaRevenueInCents: 0,
        clubMrrInCents: 0,
        activeSubscribersCount: 0,
      },
      depositConversion: {
        totalCharges: 0,
        confirmedCharges: 0,
        conversionRatePercent: 0,
      },
      attendanceComparison: {
        subscribers: { completed: 0, noShow: 0, ratePercent: null },
        avulsos: { completed: 0, noShow: 0, ratePercent: null },
      },
      upcomingRenewals7Days: {
        totalCount: 0,
        totalExpectedCents: 0,
        items: [],
      },
      rankings: {
        services: [],
        professionals: [],
      },
    });

    await app.close();
  });

  it("enforces SUPER_ADMIN_EMAILS RBAC and allows listing, inspecting and suspending/activating tenants", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", adminEmail);
    const app = await buildApp();

    // Dono comum recebe 403
    const denied = await app.inject({
      method: "GET",
      url: "/admin/overview",
      headers: { authorization: `Bearer ${normalToken}` },
    });
    expect(denied.statusCode).toBe(403);

    // Super-admin consegue consultar overview global
    const overview = await app.inject({
      method: "GET",
      url: "/admin/overview",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().totalTenants).toBeGreaterThanOrEqual(2);

    // Listagem filtrada pelo nome do tenant
    const listRes = await app.inject({
      method: "GET",
      url: `/admin/tenants?search=${encodeURIComponent("Barbearia Regular")}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json() as Array<{ id: string; isActive: boolean }>;
    expect(list.some((item) => item.id === normalCompanyId)).toBe(true);

    // Suspender tenant e atualizar plano
    const patchRes = await app.inject({
      method: "PATCH",
      url: `/admin/tenants/${normalCompanyId}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: false, saasStatus: "PAST_DUE", saasPlan: "SCALE" },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toMatchObject({
      id: normalCompanyId,
      isActive: false,
      saasStatus: "PAST_DUE",
      saasPlan: "SCALE",
    });

    // Reativar tenant
    const reactivateRes = await app.inject({
      method: "PATCH",
      url: `/admin/tenants/${normalCompanyId}/status`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isActive: true, saasStatus: "ACTIVE" },
    });
    expect(reactivateRes.statusCode).toBe(200);
    expect(reactivateRes.json()).toMatchObject({
      id: normalCompanyId,
      isActive: true,
      saasStatus: "ACTIVE",
    });

    // Detalhes do tenant
    const detailsRes = await app.inject({
      method: "GET",
      url: `/admin/tenants/${normalCompanyId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(detailsRes.statusCode).toBe(200);
    expect(detailsRes.json()).toMatchObject({
      id: normalCompanyId,
      companyName: "Barbearia Regular",
      saasPlan: "SCALE",
      saasStatus: "ACTIVE",
    });

    await app.close();
  });
});
