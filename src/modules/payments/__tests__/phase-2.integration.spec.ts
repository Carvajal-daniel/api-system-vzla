
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import fastify from "fastify";
import jwt from "jsonwebtoken";
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../shared/database/database.js";
import { registerErrorHandler } from "../../../shared/http/error-handler.js";
import { CompanyTable } from "../../Company/infra/database/schema/companies-schema.js";
import { CollaboratorTable } from "../../Collaborators/infra/database/schema/collaborators-schema.js";
import { AppointmentTable } from "../../appointments/infra/database/schema/appointments-schema.js";
import { SaasTelemetryTable } from "../../billing/infra/database/schema/saas-telemetry-schema.js";
import { ClientTable } from "../../clients/infra/database/schema/clients-schema.js";
import { computeOrderDraft } from "../../finance/domain/orders.js";
import { DrizzleOutflowsRepository } from "../../finance/infra/database/repositories/drizzle-outflows.repository.js";
import { DrizzleOrdersRepository } from "../../finance/infra/database/repositories/drizzle-orders.repository.js";
import { FinanceOrderPaymentTable, FinanceOrderTable } from "../../finance/infra/database/schema/orders-schema.js";
import { ServiceTable } from "../../services/infra/database/schema/services-schema.js";
import { ClientSubscriptionTable, CompanyPaymentConfigTable, PaymentChargeTable } from "../infra/database/schema/payments-schema.js";
import { encryptPaymentSecret } from "../infra/gateways/payment-secrets.js";
import { paymentRoutes } from "../infra/http/payment.routes.js";

vi.mock("../../../shared/database/database.js", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  return { db: drizzle({ client: new Pool({ connectionString: process.env.PHASE_2_TEST_DATABASE_URL }) }) };
});

// Only point this suite at a disposable database with the repository migrations applied.
describe.skipIf(!process.env.PHASE_2_TEST_DATABASE_URL)("Phase 2 on PostgreSQL", () => {
  const app = fastify();
  const orders = new DrizzleOrdersRepository();
  const phone = "+5511912345678";
  const hookToken = "test-only-webhook-token-1234567890";
  const jwtSecret = "test-only-payment-jwt-secret";
  let companyId: string;
  let clientId: string;
  let serviceId: string;
  let professionalId: string;
  let headers: { authorization: string };
  const day = () => new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", jwtSecret);
    vi.stubEnv("MERCADO_PAGO_BACK_URL", "https://app.example.test/assinatura");
    vi.stubEnv("PAYMENT_ENCRYPTION_KEY", "temporary-test-encryption-key-of-32-characters");
    registerErrorHandler(app);
    await app.register(paymentRoutes);
  });

  beforeEach(async () => {
    companyId = randomUUID();
    clientId = randomUUID();
    serviceId = randomUUID();
    professionalId = randomUUID();
    headers = { authorization: "Bearer " + jwt.sign({ sub: companyId, companyId, role: "OWNER" }, jwtSecret) };
    await db.insert(CompanyTable).values({ id: companyId, name: "Owner", companyName: "Pagamento teste",
      slug: `pagamento-${companyId.slice(0, 8)}`, email: companyId + "@example.test", phone, password: "fixture", timezone: "UTC" });
    await db.insert(ClientTable).values({ id: clientId, companyId, name: "Cliente teste", phone, email: "payer@example.test" });
    await db.insert(ServiceTable).values({ id: serviceId, companyId, name: "Corte", priceInCents: 5000, durationMinutes: 30 });
    await db.insert(CollaboratorTable).values({ id: professionalId, companyId, name: "Profissional", specialty: "Corte",
      commissionPercentage: 30, email: professionalId + "@example.test", password: "fixture", phone });
    const config = await app.inject({ method: "PUT", url: "/payments/config", headers, payload: { paymentProvider: "SANDBOX", webhookToken: hookToken } });
    expect(config.statusCode, config.body).toBe(200);
    expect(config.json()).not.toHaveProperty("webhookTokenEncrypted");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(PaymentChargeTable).where(eq(PaymentChargeTable.companyId, companyId));
    await db.delete(FinanceOrderTable).where(eq(FinanceOrderTable.companyId, companyId));
    await db.delete(AppointmentTable).where(eq(AppointmentTable.companyId, companyId));
    await db.delete(ClientSubscriptionTable).where(eq(ClientSubscriptionTable.companyId, companyId));
    await db.delete(CollaboratorTable).where(eq(CollaboratorTable.companyId, companyId));
    await db.delete(CompanyTable).where(eq(CompanyTable.id, companyId));
  });

  afterAll(async () => {
    await app.close();
    await db.$client.end();
    vi.unstubAllEnvs();
  });

  async function newPlan(maxMonthlyUses: number | null = null) {
    const result = await app.inject({ method: "POST", url: "/subscription-plans", headers,
      payload: { name: "Clube", priceCents: 9900, includedServiceIds: [serviceId], maxMonthlyUses } });
    expect(result.statusCode, result.body).toBe(201);
    return result.json<{ id: string; gracePeriodDays: number; allowedDaysOfWeek: number[] | null; billingCycle: string }>();
  }

  async function enroll(planId: string) {
    const result = await app.inject({ method: "POST", url: "/client-subscriptions", headers,
      payload: { planId, clientId, paymentMethod: "PIX" } });
    expect(result.statusCode, result.body).toBe(201);
    return result.json<{ id: string; status: string; externalSubscriptionId: string; checkoutUrl?: string }>();
  }

  async function charge(referenceType: string, referenceId: string, amountCents?: number) {
    const result = await app.inject({ method: "POST", url: "/payments/pix", headers,
      payload: { referenceType, referenceId, clientId, amountCents } });
    expect(result.statusCode, result.body).toBe(201);
    return result.json<{ id: string; txid: string; amountCents: number; expiresAt: string; pixQrCodeBase64: string; pixCopyPaste: string }>();
  }

  async function webhook(payment: { id: string; txid: string; amountCents: number }, useSignature = hookToken) {
    // Represent the same charge as one issued by Asaas, without an external network call.
    const externalId = "pay_" + payment.id;
    await db.update(PaymentChargeTable).set({ paymentProvider: "ASAAS", externalId }).where(eq(PaymentChargeTable.id, payment.id));
    return app.inject({ method: "POST", url: "/webhooks/payments/asaas", headers: { "asaas-access-token": useSignature },
      payload: { id: "evt_" + payment.id, event: "PAYMENT_RECEIVED", dateCreated: new Date().toISOString(),
        payment: { id: externalId, billingType: "PIX", externalReference: payment.txid, value: payment.amountCents / 100 } } });
  }

  function order(quantity = 1, appointmentId?: string) {
    return orders.createOrder(companyId, computeOrderDraft({
      requestKey: randomUUID(), clientPhone: phone, appointmentId, orderDate: day(), status: "OPEN", payments: [],
      items: [{ itemType: "SERVICE", referenceId: serviceId, name: "Corte", collaboratorId: professionalId,
        commissionPercentage: 30, quantity, unitPriceCents: 5000 }],
    }));
  }

  async function telemetry() {
    const [row] = await db.select().from(SaasTelemetryTable).where(and(
      eq(SaasTelemetryTable.companyId, companyId), eq(SaasTelemetryTable.date, day()),
    ));
    return row;
  }

  async function configureMercadoPago() {
    const config = await app.inject({ method: "PUT", url: "/payments/config", headers, payload: {
      paymentProvider: "MERCADO_PAGO", providerApiKey: "test-mercado-pago-access-token", webhookToken: hookToken,
    } });
    expect(config.statusCode, config.body).toBe(200);
    expect(config.json()).toMatchObject({
      paymentProvider: "MERCADO_PAGO", webhookPath: "/webhooks/payments/mercado-pago?companyId=" + companyId,
    });
    expect(config.json()).not.toHaveProperty("providerApiKeyEncrypted");
  }

  function mercadoPagoWebhook(type: string, resourceId: string, input: { secret?: string; bodyId?: string; includeCompany?: boolean } = {}) {
    const requestId = randomUUID();
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", input.secret ?? hookToken)
      .update("id:" + resourceId.toLowerCase() + ";request-id:" + requestId + ";ts:" + timestamp + ";").digest("hex");
    const url = "/webhooks/payments/mercado-pago?data.id=" + resourceId +
      (input.includeCompany === false ? "" : "&companyId=" + companyId);
    return app.inject({ method: "POST", url,
      headers: { "x-request-id": requestId, "x-signature": "ts=" + timestamp + ",v1=" + signature },
      payload: { type, status: "approved", data: { id: input.bodyId ?? resourceId } },
    });
  }

  it("settles a Mercado Pago Pix order once using the payment fetched from the provider", async () => {
    await configureMercadoPago();
    let reference = "";
    let status = "pending";
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      expect(options?.headers).toMatchObject({ Authorization: "Bearer test-mercado-pago-access-token" });
      if (String(url).endsWith("/v1/payments") && options?.method === "POST") {
        const data = JSON.parse(String(options.body));
        reference = data.external_reference;
        expect(options?.headers).toMatchObject({ "X-Idempotency-Key": reference });
        return Response.json({ id: 502, date_of_expiration: data.date_of_expiration,
          point_of_interaction: { transaction_data: { qr_code: "mp-pix", qr_code_base64: "encoded-mp" } } });
      }
      expect(String(url)).toBe("https://api.mercadopago.com/v1/payments/502");
      return Response.json({ id: 502, status, transaction_amount: 50, currency_id: "BRL",
        payment_method_id: "pix", external_reference: reference, date_approved: new Date().toISOString() });
    });
    const saved = await order();
    const pix = await charge("ORDER", saved.id);
    expect(pix).toMatchObject({ txid: reference, pixCopyPaste: "mp-pix", pixQrCodeBase64: "encoded-mp" });
    expect((await mercadoPagoWebhook("payment", "502", { secret: "wrong" })).statusCode).toBe(403);
    expect((await mercadoPagoWebhook("payment", "502", { bodyId: "999" })).statusCode).toBe(403);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await mercadoPagoWebhook("payment", "502", { includeCompany: false })).json()).toEqual({ processed: false });
    status = "approved";
    expect((await mercadoPagoWebhook("payment", "502")).json()).toEqual({ processed: true });
    expect((await mercadoPagoWebhook("payment", "502")).json()).toEqual({ processed: false });
    expect(await orders.getOrderById(companyId, saved.id)).toMatchObject({ status: "CLOSED", paidCents: 5000 });
    expect((await telemetry())?.gmvCents).toBe(5000);
  });

  it("persists a Mercado Pago checkout and activates the club only after its invoice payment is approved", async () => {
    await configureMercadoPago();
    const checkoutUrl = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=sub123";
    let reference = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path === "/preapproval/search") return Response.json({ results: [] });
      if (path === "/preapproval") {
        const data = JSON.parse(String(options?.body));
        expect(data.status).toBe("pending");
        reference = data.external_reference;
        return Response.json({ id: "sub123", init_point: checkoutUrl });
      }
      if (path === "/authorized_payments/777") return Response.json({
        id: 777, preapproval_id: "sub123", external_reference: reference, debit_date: new Date().toISOString(),
        payment: { id: 888, status: "approved" },
      });
      expect(path).toBe("/v1/payments/888");
      return Response.json({ id: 888, status: "approved", currency_id: "BRL", transaction_amount: 99,
        payment_type_id: "credit_card", date_approved: new Date().toISOString() });
    });
    const subscribed = await enroll((await newPlan()).id);
    expect(subscribed).toMatchObject({ id: reference, checkoutUrl, status: "PENDING_PAYMENT" });
    expect((await telemetry())?.activeClubSubscribers).toBe(0);
    expect((await mercadoPagoWebhook("subscription_authorized_payment", "777")).json()).toEqual({ processed: true });
    expect((await mercadoPagoWebhook("subscription_authorized_payment", "777")).json()).toEqual({ processed: false });
    const list = await app.inject({ method: "GET", url: "/client-subscriptions?status=ACTIVE", headers });
    expect(list.json()).toEqual([expect.objectContaining({ id: reference, paymentMethod: "CREDIT_CARD" })]);
    expect((await telemetry())?.activeClubSubscribers).toBe(1);
  });

  it("creates, lists, updates and deactivates a tenant's plan", async () => {
    const plan = await newPlan();
    expect(plan).toMatchObject({ gracePeriodDays: 3, allowedDaysOfWeek: null, billingCycle: "MONTHLY" });
    const edit = await app.inject({ method: "PATCH", url: "/subscription-plans/" + plan.id, headers,
      payload: { allowedDaysOfWeek: [3, 1, 1], gracePeriodDays: 0, active: false } });
    expect(edit.statusCode, edit.body).toBe(200);
    const list = await app.inject({ method: "GET", url: "/subscription-plans", headers });
    expect(list.json()).toEqual([expect.objectContaining({ id: plan.id, allowedDaysOfWeek: [1, 3], gracePeriodDays: 0, active: false })]);
  });

  it("settles an order once, releases commission and writes GMV", async () => {
    const saved = await order();
    const pix = await charge("ORDER", saved.id, 100); // The actual charge is derived from the order balance.
    expect(pix).toMatchObject({ amountCents: 5000, pixCopyPaste: expect.stringContaining("br.gov.bcb.pix") });
    expect(pix.pixQrCodeBase64).toMatch(/^iVBOR/);
    expect(await charge("ORDER", saved.id)).toMatchObject({ id: pix.id });
    expect((await webhook(pix, "invalid")).statusCode).toBe(403);
    const [event, retry] = await Promise.all([webhook(pix), webhook(pix)]);
    expect([event.json().processed, retry.json().processed].sort()).toEqual([false, true]);
    const finished = await orders.getOrderById(companyId, saved.id);
    expect(finished).toMatchObject({ status: "CLOSED", paidCents: 5000, items: [expect.objectContaining({ commissionCents: 1500 })] });
    expect(await db.select().from(FinanceOrderPaymentTable).where(eq(FinanceOrderPaymentTable.orderId, saved.id))).toHaveLength(1);
    expect((await telemetry())?.gmvCents).toBe(5000);
    const report = await new DrizzleOutflowsRepository().commissions(companyId, { from: day(), to: day() });
    expect(report.professionals).toEqual([expect.objectContaining({ payableInCents: 1500 })]);
  });

  it("confirms a sandbox charge through the owner-only simulation", async () => {
    const saved = await order();
    const pix = await charge("ORDER", saved.id);
    const result = await app.inject({ method: "POST", url: "/payments/" + pix.id + "/simulate-confirmation", headers });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ status: "CONFIRMED" });
  });

  it("activates a subscription once and covers only the remaining allowance", async () => {
    const plan = await newPlan(1);
    const subscription = await enroll(plan.id);
    expect(subscription.status).toBe("PENDING_PAYMENT");
    const pix = await charge("SUBSCRIPTION", subscription.id);
    expect((await webhook(pix)).json()).toEqual({ processed: true });
    expect((await webhook(pix)).json()).toEqual({ processed: false });
    const list = await app.inject({ method: "GET", url: "/client-subscriptions?status=ACTIVE", headers });
    expect(list.json()).toEqual([expect.objectContaining({ id: subscription.id, currentPeriodEnd: expect.any(String) })]);
    expect((await telemetry())?.activeClubSubscribers).toBe(1);
    const covered = await order(2);
    expect(covered.totalCents).toBe(5000);
    expect(covered.items.map((item) => item.unitPriceCents).sort((a, b) => a - b)).toEqual([0, 5000]);
    expect((await order()).totalCents).toBe(5000);
  });

  async function appointmentFixture() {
    const startsAt = new Date(Date.now() + 3_600_000);
    const [appointment] = await db.insert(AppointmentTable).values({
      companyId, serviceId, collaboratorId: professionalId, clientName: "Cliente teste", clientPhone: phone,
      startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status: "PENDING",
      serviceNameSnapshot: "Corte", servicePriceInCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30, commissionPercentageSnapshot: 30,
    }).returning();
    return appointment!;
  }

  it("accounts for linked service commission once when the online order is paid", async () => {
    const appointment = await appointmentFixture();
    const saved = await order(1, appointment.id);
    const pix = await charge("ORDER", saved.id);
    const event = await webhook(pix);
    expect(event.statusCode, event.body).toBe(200);
    const report = await new DrizzleOutflowsRepository().commissions(companyId, { from: day(), to: day() });
    expect(report.professionals).toEqual([expect.objectContaining({ payableInCents: 1500, forecastInCents: 0 })]);
  });

  it("settles a deposit once and confirms its pending reservation", async () => {
    const appointment = await appointmentFixture();
    const pix = await charge("APPOINTMENT_DEPOSIT", appointment.id, 1000);
    expect(Date.parse(pix.expiresAt) - Date.now()).toBeGreaterThan(890_000);
    expect(Date.parse(pix.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);
    expect((await webhook(pix)).json()).toEqual({ processed: true });
    expect((await webhook(pix)).json()).toEqual({ processed: false });
    const [confirmed] = await db.select().from(AppointmentTable).where(eq(AppointmentTable.id, appointment!.id));
    expect(confirmed?.status).toBe("CONFIRMED");
    const status = await app.inject({ method: "GET", url: "/payments/" + pix.id + "/status", headers });
    expect(status.json()).toMatchObject({ status: "CONFIRMED", paidAt: expect.any(String) });
  });
});
