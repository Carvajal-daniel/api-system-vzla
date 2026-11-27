
import { timingSafeEqual } from "node:crypto";
import type { PaymentGatewayPort } from "../../domain/payment-gateway.js";
import { encodePixCode } from "./pix-code.js";

export function matchWebhookToken(received: string | undefined, expected: string) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SandboxPaymentAdapter implements PaymentGatewayPort {
  async createDynamicPixCharge(input: Parameters<PaymentGatewayPort["createDynamicPixCharge"]>[0]) {
    return {
      // The sandbox address is intentionally non-routable so a simulated charge cannot move real money.
      ...await encodePixCode("pix@example.invalid", "SANDBOX TESTE", input.amountCents, input.txid),
      externalId: input.txid,
      expiresAt: input.expiresAt,
      method: "PIX_DYNAMIC" as const,
    };
  }

  async createRecurringSubscription(input: Parameters<PaymentGatewayPort["createRecurringSubscription"]>[0]) {
    return { externalSubscriptionId: "sandbox-" + input.reference };
  }

  verifyWebhookSignature(received: string | undefined, expected: string) {
    return matchWebhookToken(received, expected);
  }
}
