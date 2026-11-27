
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MercadoPagoPaymentAdapter } from "../infra/gateways/mercado-pago-payment.adapter.js";

const txid = "f10b12c0-46bb-400e-afa5-e0b518e09258";
const customer = { id: "customer", name: "Cliente", email: "client@example.test", phone: "+5511999998888", document: "12345678901" };
const expiresAt = new Date("2027-02-02T15:00:00.000Z");

afterEach(() => vi.unstubAllEnvs());

describe("Mercado Pago adapter", () => {
  it("creates an idempotent Pix payment and normalizes the QR and provider expiry", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      id: 123, date_of_expiration: "2027-02-02T12:00:00.000-03:00",
      point_of_interaction: { transaction_data: { qr_code: "pix-data", qr_code_base64: "encoded-qr" } },
    }));
    const adapter = new MercadoPagoPaymentAdapter("test-merchant-key", transport);
    const input = { txid, customer, amountCents: 1535, dueDate: "2027-02-01", expiresAt, shortExpiry: false, pixKey: null, merchantName: "Clube" };
    await expect(adapter.createDynamicPixCharge(input)).resolves.toEqual({
      txid, externalId: "123", method: "PIX_DYNAMIC", pixCopyPaste: "pix-data", pixQrCodeBase64: "encoded-qr", expiresAt,
    });
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://api.mercadopago.com/v1/payments");
    expect(options?.headers).toMatchObject({ Authorization: "Bearer test-merchant-key", "X-Idempotency-Key": txid });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      payment_method_id: "pix", transaction_amount: 15.35, external_reference: txid,
      date_of_expiration: expiresAt.toISOString(), payer: { email: customer.email, identification: { type: "CPF", number: customer.document } },
    });
    await expect(adapter.createDynamicPixCharge({ ...input, shortExpiry: true }))
      .rejects.toMatchObject({ reasonCode: "MERCADO_PAGO_DEPOSIT_EXPIRY_UNSUPPORTED" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("creates a monthly preapproval with a tokenized card or recovers an existing checkout", async () => {
    vi.stubEnv("MERCADO_PAGO_BACK_URL", "https://app.example.test/assinatura");
    const checkoutUrl = "https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=sub123";
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ results: [] }))
      .mockResolvedValueOnce(Response.json({ id: "sub123", init_point: checkoutUrl }))
      .mockResolvedValueOnce(Response.json({ results: [{ id: "sub123", external_reference: txid, init_point: checkoutUrl }] }));
    const adapter = new MercadoPagoPaymentAdapter("test-merchant-key", transport);
    const input = { reference: txid, customer, amountCents: 9900, method: "CREDIT_CARD" as const,
      firstDueDate: "2027-02-01", description: "Plano Clube", cardToken: "test-card-token" };
    await expect(adapter.createRecurringSubscription(input)).resolves.toEqual({ externalSubscriptionId: "sub123", checkoutUrl });
    const [url, options] = transport.mock.calls[1]!;
    expect(url).toBe("https://api.mercadopago.com/preapproval");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      card_token_id: "test-card-token", status: "authorized", payer_email: customer.email,
      external_reference: txid, back_url: "https://app.example.test/assinatura",
      auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "BRL", transaction_amount: 99 },
    });
    await expect(adapter.createRecurringSubscription(input)).resolves.toMatchObject({ externalSubscriptionId: "sub123", checkoutUrl });
    expect(transport.mock.calls.filter(([, request]) => request?.method === "POST")).toHaveLength(1);
  });

  it("authenticates the signed URL resource and ignores payment states other than approved", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      id: 123, status: "pending", currency_id: "BRL", transaction_amount: 15.35, payment_method_id: "pix",
    }));
    const adapter = new MercadoPagoPaymentAdapter("test-merchant-key", transport);
    const context = { resourceId: "AB123", requestId: "request-test" };
    const timestamp = "1742505638683";
    const secret = "test-webhook";
    const digest = createHmac("sha256", secret)
      .update("id:ab123;request-id:request-test;ts:" + timestamp + ";").digest("hex");
    const signature = "ts=" + timestamp + ",v1=" + digest;
    expect(adapter.verifyWebhookSignature(signature, secret, context)).toBe(true);
    expect(adapter.verifyWebhookSignature(signature, secret, { ...context, resourceId: "AB124" })).toBe(false);
    expect(adapter.verifyWebhookSignature(signature + ",v1=" + digest, secret, context)).toBe(false);
    await expect(adapter.readWebhookPayment("payment", "123")).resolves.toBeNull();
  });
});
