
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { GatewayCustomer, GatewayPaymentEvent, PaymentGatewayPort, WebhookSignatureContext } from "../../domain/payment-gateway.js";
import { PaymentError, paymentConflict } from "../../domain/payment-policy.js";

const providerId = z.union([z.string().min(1).max(160), z.number().int().positive()]).transform(String);
const apiDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const subscription = z.object({
  id: providerId, external_reference: providerId.nullish(), init_point: z.url().nullish(),
});
const subscriptionPage = z.object({
  results: z.array(subscription),
  paging: z.object({ total: z.number().int().nonnegative() }).optional(),
});
const pixPayment = z.object({
  id: providerId, date_of_expiration: apiDate,
  point_of_interaction: z.object({ transaction_data: z.object({
    qr_code_base64: z.string().min(1), qr_code: z.string().min(1),
  }) }),
});
const payment = z.object({
  id: providerId, status: z.string(), external_reference: providerId.nullish(),
  payment_type_id: z.string().nullish(), payment_method_id: z.string().nullish(),
  transaction_amount: z.number().positive().max(21474836.47), currency_id: z.string(),
  date_approved: apiDate.nullish(),
});
const invoice = z.object({
  id: providerId, preapproval_id: providerId, external_reference: providerId.nullish(),
  debit_date: z.iso.datetime({ offset: true }),
  payment: z.object({ id: providerId.nullish(), status: z.string().nullish() }).nullish(),
});

export type MercadoPagoWebhookTopic = "payment" | "subscription_authorized_payment";

const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  public_key: z.string().min(1).optional(),
  user_id: providerId,
  expires_in: z.number().int().positive(),
});

export interface MercadoPagoOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  publicKey: string | null;
  userId: string;
  expiresIn: number;
}

// Monta a URL oficial de autorização OAuth do Mercado Pago Brasil com state assinado anti-CSRF.
export function buildMercadoPagoAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const params = new URLSearchParams({
    client_id: input.clientId,
    response_type: "code",
    platform_id: "mp",
    state: input.state,
    redirect_uri: input.redirectUri,
  });
  return `https://auth.mercadopago.com.br/authorization?${params.toString()}`;
}

async function requestMercadoPagoOAuthToken(
  payload: Record<string, string>,
  transport: typeof fetch = fetch,
): Promise<MercadoPagoOAuthTokens> {
  try {
    const response = await transport("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const parsed = oauthTokenResponseSchema.parse(await response.json());
      return {
        accessToken: parsed.access_token,
        refreshToken: parsed.refresh_token ?? null,
        publicKey: parsed.public_key ?? null,
        userId: parsed.user_id,
        expiresIn: parsed.expires_in,
      };
    }
  } catch {
    // Mantém credenciais e payload bruto do provedor fora das mensagens de erro expostas.
  }
  throw new PaymentError(
    "Falha ao autenticar conta no Mercado Pago.",
    "BAD_GATEWAY",
    "MERCADO_PAGO_OAUTH_FAILED",
  );
}

export function exchangeMercadoPagoOAuthCode(
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  transport: typeof fetch = fetch,
): Promise<MercadoPagoOAuthTokens> {
  return requestMercadoPagoOAuthToken(
    {
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    },
    transport,
  );
}

// Renova automaticamente o access_token OAuth antes do vencimento usando refresh_token.
export function refreshMercadoPagoOAuthToken(
  input: { clientId: string; clientSecret: string; refreshToken: string },
  transport: typeof fetch = fetch,
): Promise<MercadoPagoOAuthTokens> {
  return requestMercadoPagoOAuthToken(
    {
      grant_type: "refresh_token",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    transport,
  );
}

export function mercadoPagoPayerEmail(customer: GatewayCustomer) {
  const email = z.email().safeParse(customer.email?.trim());
  if (!email.success) {
    throw new PaymentError("Cadastre um e-mail válido para o cliente.", "VALIDATION", "MERCADO_PAGO_PAYER_EMAIL_REQUIRED");
  }
  return email.data;
}

function subscriptionReturnUrl() {
  const result = z.url({ protocol: /^https$/ }).safeParse(process.env.MERCADO_PAGO_BACK_URL);
  if (!result.success) {
    throw paymentConflict("MERCADO_PAGO_BACK_URL_REQUIRED", "Configure a URL HTTPS de retorno das assinaturas.");
  }
  return result.data;
}

export class MercadoPagoPaymentAdapter implements PaymentGatewayPort {
  constructor(private readonly accessToken: string, private readonly transport = fetch) {}

  private async request<T>(schema: z.ZodType<T>, path: string, options: {
    body?: object; idempotencyKey?: string;
  } = {}): Promise<T> {
    try {
      const response = await this.transport("https://api.mercadopago.com" + path, {
        method: options.body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + this.accessToken,
          Accept: "application/json",
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.idempotencyKey ? { "X-Idempotency-Key": options.idempotencyKey } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return schema.parse(await response.json());
    } catch {
      // Keep credentials and provider response bodies out of application errors.
    }
    throw paymentConflict("MERCADO_PAGO_REQUEST_FAILED", "Falha ao consultar o Mercado Pago.");
  }

  async createDynamicPixCharge(input: Parameters<PaymentGatewayPort["createDynamicPixCharge"]>[0]) {
    if (input.shortExpiry) {
      throw paymentConflict("MERCADO_PAGO_DEPOSIT_EXPIRY_UNSUPPORTED", "O Pix do Mercado Pago tem validade mínima de 30 minutos.");
    }
    if (input.externalSubscriptionId) {
      throw paymentConflict("MERCADO_PAGO_SUBSCRIPTION_USE_CHECKOUT", "Use o checkout da assinatura no Mercado Pago.");
    }
    const payer = {
      email: mercadoPagoPayerEmail(input.customer),
      ...(input.customer.document ? {
        identification: {
          type: input.customer.document.length === 11 ? "CPF" : "CNPJ",
          number: input.customer.document,
        },
      } : {}),
    };
    const result = await this.request(pixPayment, "/v1/payments", {
      idempotencyKey: input.txid,
      body: {
        payment_method_id: "pix",
        transaction_amount: input.amountCents / 100,
        external_reference: input.txid,
        date_of_expiration: input.expiresAt.toISOString(),
        description: input.merchantName.slice(0, 200),
        payer,
      },
    });
    const { qr_code, qr_code_base64 } = result.point_of_interaction.transaction_data;
    return { txid: input.txid, externalId: result.id, method: "PIX_DYNAMIC" as const,
      pixQrCodeBase64: qr_code_base64, pixCopyPaste: qr_code, expiresAt: result.date_of_expiration };
  }

  async createRecurringSubscription(input: Parameters<PaymentGatewayPort["createRecurringSubscription"]>[0]) {
    const email = mercadoPagoPayerEmail(input.customer);
    const backUrl = subscriptionReturnUrl();
    const cardToken = input.method === "CREDIT_CARD" ? input.cardToken : undefined;
    let existing: z.infer<typeof subscription> | undefined;
    const filters = new URLSearchParams({ payer_email: email, limit: "50" });
    let offset = 0;
    do {
      filters.set("offset", String(offset));
      const page = await this.request(subscriptionPage, "/preapproval/search?" + filters);
      existing = page.results.find((item) => item.external_reference === input.reference);
      offset += page.results.length;
      if (existing || !page.results.length || offset >= (page.paging?.total ?? 0)) break;
    } while (true);

    const result = existing ?? await this.request(subscription, "/preapproval", {
      idempotencyKey: input.reference,
      body: {
        reason: input.description,
        payer_email: email,
        external_reference: input.reference,
        back_url: backUrl,
        status: cardToken ? "authorized" : "pending",
        ...(cardToken ? { card_token_id: cardToken } : {}),
        auto_recurring: { frequency: 1, frequency_type: "months", currency_id: "BRL",
          transaction_amount: input.amountCents / 100 },
      },
    });
    const checkoutUrl = result.init_point ?? null;
    if ((!cardToken && !checkoutUrl) || (checkoutUrl && !checkoutUrl.startsWith("https://"))) {
      throw paymentConflict("MERCADO_PAGO_CHECKOUT_UNAVAILABLE", "O Mercado Pago não retornou um checkout HTTPS.");
    }
    return { externalSubscriptionId: result.id, checkoutUrl };
  }

  verifyWebhookSignature(received: string | undefined, expected: string, context?: WebhookSignatureContext) {
    if (!received || !expected || !context?.resourceId || !context.requestId) return false;
    const fields = received.split(",").map((field) => field.trim());
    const timestamps = fields.filter((field) => field.startsWith("ts="));
    const signatures = fields.filter((field) => field.startsWith("v1="));
    if (timestamps.length !== 1 || signatures.length !== 1) return false;
    const timestamp = timestamps[0]!.slice(3);
    const signature = signatures[0]!.slice(3);
    if (!/^\d{1,16}$/.test(timestamp) || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
    const manifest = "id:" + context.resourceId.toLowerCase() + ";request-id:" + context.requestId + ";ts:" + timestamp + ";";
    const digest = createHmac("sha256", expected).update(manifest).digest();
    return timingSafeEqual(digest, Buffer.from(signature, "hex"));
  }

  async isPixCanceled(externalId: string) {
    const data = await this.request(z.object({ id: providerId, status: z.string() }),
      "/v1/payments/" + encodeURIComponent(externalId));
    return data.id === externalId && data.status === "cancelled";
  }

  async refreshAccessToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }) {
    return refreshMercadoPagoOAuthToken(input, this.transport);
  }

  async readWebhookPayment(topic: MercadoPagoWebhookTopic, resourceId: string): Promise<GatewayPaymentEvent | null> {
    const isInvoice = topic === "subscription_authorized_payment";
    const cycle = isInvoice ? await this.request(invoice, "/authorized_payments/" + encodeURIComponent(resourceId)) : null;
    if (cycle && (cycle.id !== resourceId || cycle.payment?.status !== "approved" || !cycle.payment.id)) return null;
    const paymentId = cycle?.payment?.id ?? resourceId;
    const data = await this.request(payment, "/v1/payments/" + encodeURIComponent(paymentId));
    if (data.id !== paymentId || data.status !== "approved" || data.currency_id !== "BRL" || !data.date_approved) return null;
    const method = data.payment_method_id === "pix" ? "PIX"
      : data.payment_type_id === "credit_card" ? "CREDIT_CARD" : null;
    if (!method) return null;
    return {
      eventId: "mercado-pago:" + data.id,
      externalId: data.id,
      externalSubscriptionId: cycle?.preapproval_id,
      reference: cycle?.external_reference ?? data.external_reference ?? undefined,
      amountCents: Math.round(data.transaction_amount * 100),
      method,
      paidAt: data.date_approved,
      dueDate: cycle?.debit_date.slice(0, 10),
    };
  }
}
