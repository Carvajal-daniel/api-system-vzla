import { drizzle } from "drizzle-orm/node-postgres";
import fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientRecoveryRoutes } from "../../../modules/clients/infra/http/client-recovery.routes.js";
import { resetActorStatusVerifier, setActorStatusVerifier } from "../auth/authenticate.js";
import { registerErrorHandler } from "../error-handler.js";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("../../database/database.js", () => ({ db: drizzle({ client: Object.assign(new Pool(), { query }) }) }));

const companyId = "26e23a0f-9b29-4f4f-a438-cf235ba2aa29";
const otherCompany = "fd3e5a33-88a8-485a-866e-7e7535067e37";
const approvalId = "d1b41d80-d89f-426e-818f-d563e335d44b";
const clientId = "c_5521999999999";
const approvedMessage = "Hola, Ana. ¿Cómo podemos mejorar tu próxima visita?";
const now = new Date("2026-11-23T12:00:00Z");
const client = {
  id: clientId, name: "Ana Silva", phone: "+5521999999999", service_name: "Corte", price: 3800,
  collaborator_name: "Marta", completed_at: "2026-09-18 12:00:00+00",
  stars: 2, comment: "Mucho tiempo de espera.", canceled_at: "2026-10-01 12:00:00+00",
  cancel_reason: "Sin disponibilidad", canceled_last: true,
};
const secret = "a-test-secret-for-client-recovery";
function owner(role = "OWNER") {
  return { authorization: `Bearer ${jwt.sign({ sub: companyId, companyId, role }, secret)}` };
}

describe("client recovery", () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    vi.stubEnv("JWT_SECRET", secret);
    setActorStatusVerifier(async () => true);
    app = fastify();
    registerErrorHandler(app);
    await app.register(clientRecoveryRoutes);
  });

  afterEach(async () => {
    await app.close();
    resetActorStatusVerifier();
    query.mockReset();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requires an owner and rejects unsupported day filters", async () => {
    const url = "/v1/clients/inactive";
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: owner("COLLABORATOR") })).statusCode).toBe(403);
    expect((await app.inject({ url: `${url}?inactiveDays=31`, headers: owner() })).statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries within the authenticated company and prioritizes low ratings", async () => {
    query.mockResolvedValueOnce({ rows: [["Estúdio", { locale: "es" }, { countryCode: "BR" }]] })
      .mockResolvedValueOnce({ rows: [client] });
    const response = await app.inject({ url: `/v1/clients/inactive?inactiveDays=45&companyId=${otherCompany}`, headers: owner() });
    expect(response.statusCode).toBe(200);
    expect(response.json().clients[0]).toMatchObject({
      id: clientId, diagnosticTag: "LOW_RATING",
      lastReview: { stars: 2, comment: client.comment },
      lastVisit: { price: 3800, daysSinceLastVisit: 66 },
      lastCancellation: { cancelReason: client.cancel_reason },
    });
    expect(query.mock.calls[1]![1]).toContain("2026-10-09T12:00:00.000Z");
    expect(query.mock.calls[1]![1]).toContain(companyId);
    expect(query.mock.calls[1]![1]).not.toContain(otherCompany);
  });

  it("generates an empathetic draft in the company locale without submitting it", async () => {
    query.mockResolvedValueOnce({ rows: [["Estúdio", { locale: "es" }, { countryCode: "BR" }]] })
      .mockResolvedValueOnce({ rows: [client] });
    vi.stubEnv("OPENAI_API_KEY", "ai-test-key");
    vi.stubEnv("RECOVERY_OPENAI_MODEL", "test-model");
    const fetchMock = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      expect(body.instructions).toContain("WhatsApp message in es");
      expect(body.instructions).toContain("may have fallen short");
      expect(body.input).toContain("20%");
      expect(body.input).not.toContain(client.phone);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: approvedMessage }] }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await app.inject({ method: "POST", url: "/v1/clients/recovery/generate-message", headers: owner(),
      payload: { clientId, campaignGoal: "FEEDBACK", customOffer: "20%" } });
    expect(response.json()).toEqual({ message: approvedMessage });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("preserves approvals across retries when provider accepted = %s", async (accepted) => {
    vi.stubEnv("WHATSAPP_EVOLUTION_URL", "https://gateway.example");
    vi.stubEnv("WHATSAPP_EVOLUTION_API_KEY", "wa-test-key");
    vi.stubEnv("WHATSAPP_EVOLUTION_INSTANCES", JSON.stringify({ [companyId]: "tenant-instance" }));
    query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [["Estúdio", { locale: "es" }, { countryCode: "BR" }]] })
      .mockResolvedValueOnce({ rows: [client] })
      .mockResolvedValueOnce({ rows: [[approvalId]] });
    if (accepted) query.mockResolvedValueOnce({ rows: [] });
    query.mockResolvedValueOnce({ rows: [[companyId, approvalId, clientId, approvedMessage, now, accepted ? "wa-message-id" : null, accepted ? now : null]] });
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      if (url.includes("/instance/connectionState/")) return Response.json({ instance: { state: "open" } });
      expect(url).toBe("https://gateway.example/message/sendText/tenant-instance");
      expect(JSON.parse(String(options.body))).toMatchObject({ number: client.phone.slice(1), text: approvedMessage });
      if (!accepted) throw new Error("timeout");
      return Response.json({ key: { id: "wa-message-id" } }, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const request = { method: "POST" as const, url: "/v1/clients/recovery/send", headers: owner(), payload: { clientId, approvedMessage, approvalId } };
    expect((await app.inject(request)).statusCode).toBe(accepted ? 200 : 502);
    const retry = await app.inject(request);
    expect(retry.statusCode).toBe(accepted ? 200 : 409);
    expect(retry.json()).toMatchObject(accepted ? { messageId: "wa-message-id" } : { code: "RECOVERY_SEND_UNKNOWN" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
