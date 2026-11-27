
import { describe, expect, it, vi } from "vitest";
import { nextMonthlyDate } from "../domain/payment-policy.js";
import { AsaasPaymentAdapter } from "../infra/gateways/asaas-payment.adapter.js";
import { SandboxPaymentAdapter } from "../infra/gateways/sandbox-payment.adapter.js";

const txid = "194bab5d-0fe0-4e14-9ef3-38e65c98adc2";
const input = {
  txid, customer: { id: txid, document: "01234567890", name: "Teste", email: null, phone: "+5511912345678" },
  amountCents: 4200, dueDate: "2026-01-31", expiresAt: new Date("2026-01-31T12:15:00Z"),
  shortExpiry: false, merchantName: "Clube", pixKey: null,
};

describe("payment gateways", () => {
  it("encodes a sandbox EMV payload and PNG without a routable Pix key", async () => {
    const adapter = new SandboxPaymentAdapter();
    const result = await adapter.createDynamicPixCharge(input);
    expect(result.pixCopyPaste).toMatch(/^000201.*br.gov.bcb.pix.*pix@example.invalid.*540542\.00.*6304[0-9A-F]{4}$/);
    expect(Buffer.from(result.pixQrCodeBase64, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(result.expiresAt).toBe(input.expiresAt);
    expect(adapter.verifyWebhookSignature("invalid", "test-webhook")).toBe(false);
    expect(adapter.verifyWebhookSignature("test-webhook", "test-webhook")).toBe(true);
  });

  it("keeps the monthly period within February for late-month billing", () => {
    expect(nextMonthlyDate("2026-01-31")).toBe("2026-02-28");
    expect(nextMonthlyDate("2028-01-31")).toBe("2028-02-29");
  });

  it("reuses a provider charge by external reference before fetching its QR", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "pay_test" }] }))
      .mockResolvedValueOnce(Response.json({ encodedImage: "image", payload: "copy", expirationDate: "2026-02-01 12:00:00" }));
    const charge = await new AsaasPaymentAdapter("test-key", transport).createDynamicPixCharge(input);
    expect(transport.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/v3/payments", "/v3/payments/pay_test/pixQrCode"]);
    expect(charge).toMatchObject({ externalId: "pay_test", pixCopyPaste: "copy", method: "PIX_DYNAMIC" });
  });

  it("uses a single-use Pix with provider-side expiry for deposits", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "key-test", key: "sandbox@example.invalid", status: "ACTIVE" }] }))
      .mockResolvedValueOnce(Response.json({ id: "qr_test", encodedImage: "image", payload: "copy" }));
    const expiresAt = new Date(Date.now() + 900_000);
    const charge = await new AsaasPaymentAdapter("test-key", transport)
      .createDynamicPixCharge({ ...input, shortExpiry: true, expiresAt });
    const [, request] = transport.mock.calls[1]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      addressKey: "key-test", allowsMultiplePayments: false, externalReference: txid, value: 42,
    });
    const seconds = JSON.parse(String(request?.body)).expirationSeconds;
    expect(seconds).toBeGreaterThanOrEqual(898);
    expect(seconds).toBeLessThanOrEqual(900);
    expect(charge.method).toBe("PIX_STATIC");
  });
});
