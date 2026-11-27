
import { z } from "zod";
import { PaymentError } from "../../domain/payment-policy.js";
import type { GatewayCustomer, PaymentGatewayPort } from "../../domain/payment-gateway.js";
import { matchWebhookToken } from "./sandbox-payment.adapter.js";

const entity = z.object({ id: z.string() });
const list = z.object({ data: z.array(entity) });
const subscriptionPayments = z.object({ data: z.array(entity.extend({
  status: z.string(), dueDate: z.string(), originalDueDate: z.string().nullish(),
})) });

const createdSubaccountSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(1),
  walletId: z.string().min(1),
  name: z.string().optional(),
  email: z.string().optional(),
});

export interface AsaasSubaccountInput {
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone: string;
  incomeValue: number;
  address?: string | undefined;
  addressNumber?: string | undefined;
  postalCode?: string | undefined;
}

export interface AsaasSubaccountResult {
  accountId: string;
  apiKey: string;
  walletId: string;
  accountLabel: string;
}

function asaasBaseUrl() {
  return process.env.ASAAS_ENVIRONMENT === "production"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

// Cria subconta expressa no Asaas usando a chave mestra da plataforma, evitando cópia manual de API Key pelo dono.
export async function createAsaasSubaccount(
  masterApiKey: string,
  input: AsaasSubaccountInput,
  transport: typeof fetch = fetch,
): Promise<AsaasSubaccountResult> {
  try {
    const response = await transport(asaasBaseUrl() + "/accounts", {
      method: "POST",
      headers: {
        access_token: masterApiKey,
        "Content-Type": "application/json",
        "User-Agent": "Atelier-Agenda/1.0",
      },
      body: JSON.stringify({
        name: input.name,
        email: input.email,
        cpfCnpj: input.cpfCnpj.replace(/\D/g, ""),
        mobilePhone: input.mobilePhone.replace(/\D/g, ""),
        incomeValue: input.incomeValue,
        ...(input.address ? { address: input.address } : {}),
        ...(input.addressNumber ? { addressNumber: input.addressNumber } : {}),
        ...(input.postalCode ? { postalCode: input.postalCode.replace(/\D/g, "") } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (response.ok) {
      const parsed = createdSubaccountSchema.parse(await response.json());
      return {
        accountId: parsed.id,
        apiKey: parsed.apiKey,
        walletId: parsed.walletId,
        accountLabel: parsed.email?.trim() || parsed.name?.trim() || input.email,
      };
    }

    const errorPayload = await response.json().catch(() => null) as {
      errors?: Array<{ description?: string }>;
      message?: string;
    } | null;
    const gatewayMessage =
      errorPayload?.errors?.[0]?.description?.trim() ||
      errorPayload?.message?.trim() ||
      "Não foi possível criar a subconta no Asaas.";
    throw new PaymentError(gatewayMessage, "BAD_GATEWAY", "ASAAS_SUBACCOUNT_CREATION_FAILED");
  } catch (error) {
    if (error instanceof PaymentError) throw error;
  }
  throw new PaymentError(
    "Não foi possível criar a subconta no Asaas.",
    "BAD_GATEWAY",
    "ASAAS_SUBACCOUNT_CREATION_FAILED",
  );
}

export class AsaasPaymentAdapter implements PaymentGatewayPort {
  constructor(private readonly key: string, private readonly transport = fetch) {}

  private async request(path: string, body?: object, timeout = 15_000) {
    const base = process.env.ASAAS_ENVIRONMENT === "production"
      ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3";
    try {
      const response = await this.transport(base + path, {
        method: body ? "POST" : "GET",
        headers: { access_token: this.key, "Content-Type": "application/json", "User-Agent": "Atelier-Agenda/1.0" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
      if (response.ok) return await response.json() as unknown;
      // Extrai a mensagem real retornada pelo Asaas para não mascarar o motivo da recusa no portal público.
      const errorPayload = await response.json().catch(() => null) as {
        errors?: Array<{ description?: string }>;
        message?: string;
      } | null;
      const gatewayMessage =
        errorPayload?.errors?.[0]?.description?.trim() ||
        errorPayload?.message?.trim() ||
        "Falha ao consultar o provedor de pagamentos.";
      throw new PaymentError(gatewayMessage, "BAD_GATEWAY", "ASAAS_REQUEST_FAILED");
    } catch (error) {
      if (error instanceof PaymentError) throw error;
      // A transport error can have an unknown outcome. The caller retries with the same external reference.
    }
    throw new PaymentError("Falha ao consultar o provedor de pagamentos.", "BAD_GATEWAY", "ASAAS_REQUEST_FAILED");
  }

  private async existing(path: string, reference: string) {
    return list.parse(await this.request(path + "?externalReference=" + encodeURIComponent(reference))).data[0];
  }

  private async customer(customer: GatewayCustomer) {
    const existing = await this.existing("/customers", customer.id);
    if (existing) return existing.id;
    if (!customer.document) {
      throw new PaymentError("Informe CPF ou CNPJ para cadastrar o cliente no Asaas.", "VALIDATION", "PAYMENT_CUSTOMER_DOCUMENT_REQUIRED");
    }
    return entity.parse(await this.request("/customers", {
      name: customer.name,
      cpfCnpj: customer.document,
      mobilePhone: customer.phone,
      email: customer.email ?? undefined,
      externalReference: customer.id,
    })).id;
  }

  async createDynamicPixCharge(input: Parameters<PaymentGatewayPort["createDynamicPixCharge"]>[0]) {
    if (input.shortExpiry) {
      // Asaas payment QR codes do not support a short expiry. Use its single-use QR endpoint.
      const keys = z.object({ data: z.array(z.object({ id: z.string(), key: z.string(), status: z.string() })) })
        .parse(await this.request("/pix/addressKeys?status=ACTIVE&limit=100")).data;
      const key = keys.find((item) => item.status === "ACTIVE" && (!input.pixKey || item.key === input.pixKey || item.id === input.pixKey));
      if (!key) throw new PaymentError("Cadastre uma chave Pix ativa no Asaas.", "VALIDATION", "ASAAS_PIX_KEY_REQUIRED");
      const qr = z.object({ id: z.string(), encodedImage: z.string(), payload: z.string() })
        .parse(await this.request("/pix/qrCodes/static", {
          addressKey: key.id, value: input.amountCents / 100, format: "ALL",
          expirationSeconds: Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)),
          allowsMultiplePayments: false, externalReference: input.txid,
        }));
      return { txid: input.txid, externalId: qr.id, pixQrCodeBase64: qr.encodedImage, pixCopyPaste: qr.payload, expiresAt: input.expiresAt, method: "PIX_STATIC" as const };
    }

    const payment = input.externalSubscriptionId
      ? subscriptionPayments.parse(await this.request("/subscriptions/" + encodeURIComponent(input.externalSubscriptionId) + "/payments"))
        .data.filter((item) => ["PENDING", "OVERDUE"].includes(item.status) && (item.originalDueDate ?? item.dueDate) >= input.dueDate)
        .sort((left, right) => (left.originalDueDate ?? left.dueDate).localeCompare(right.originalDueDate ?? right.dueDate))[0]
      : await this.existing("/payments", input.txid) ?? entity.parse(await this.request("/payments", {
      customer: await this.customer(input.customer), billingType: "PIX",
      value: input.amountCents / 100, dueDate: input.dueDate, externalReference: input.txid,
    }));
    if (!payment) throw new PaymentError("O ciclo ainda não tem cobrança Pix disponível.", "CONFLICT", "PIX_SUBSCRIPTION_PAYMENT_UNAVAILABLE");
    const code = z.object({ encodedImage: z.string(), payload: z.string(), expirationDate: z.string() })
      .parse(await this.request("/payments/" + encodeURIComponent(payment.id) + "/pixQrCode"));
    const expiration = code.expirationDate.replace(" ", "T");
    const expiresAt = new Date(expiration.length === 19 ? expiration + "-03:00" : expiration);
    if (!Number.isFinite(expiresAt.getTime())) throw new Error("Asaas returned an invalid expiration date");
    return { txid: input.txid, externalId: payment.id, pixQrCodeBase64: code.encodedImage, pixCopyPaste: code.payload, expiresAt, method: "PIX_DYNAMIC" as const };
  }

  async createRecurringSubscription(input: Parameters<PaymentGatewayPort["createRecurringSubscription"]>[0]) {
    if (input.method === "CREDIT_CARD" && (!input.cardToken || !input.remoteIp)) {
      throw new PaymentError("Informe um token de cartão válido para o cliente.", "VALIDATION", "PAYMENT_CARD_TOKEN_REQUIRED");
    }
    const subscription = await this.existing("/subscriptions", input.reference) ?? entity.parse(await this.request("/subscriptions", {
      customer: await this.customer(input.customer), billingType: input.method,
      value: input.amountCents / 100, cycle: "MONTHLY", nextDueDate: input.firstDueDate,
      externalReference: input.reference, description: input.description,
      creditCardToken: input.cardToken, remoteIp: input.remoteIp,
    }, 65_000));
    return { externalSubscriptionId: subscription.id };
  }

  verifyWebhookSignature(received: string | undefined, expected: string) {
    return matchWebhookToken(received, expected);
  }
}
