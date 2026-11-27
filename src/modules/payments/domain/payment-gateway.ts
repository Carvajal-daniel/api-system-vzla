
export const onlinePaymentProviders = ["ASAAS", "MERCADO_PAGO", "SANDBOX"] as const;
export const paymentProviders = ["NONE", ...onlinePaymentProviders] as const;
export const chargeReferences = ["ORDER", "SUBSCRIPTION", "APPOINTMENT_DEPOSIT"] as const;
export const subscriptionStatuses = ["PENDING_PAYMENT", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELED"] as const;
export const subscriptionMethods = ["PIX", "CREDIT_CARD"] as const;
export const chargeMethods = ["PIX_DYNAMIC", "PIX_STATIC", "CREDIT_CARD"] as const;
export const chargeStatuses = ["PENDING", "CONFIRMED", "EXPIRED", "CANCELED"] as const;

export type ChargeReference = typeof chargeReferences[number];
export type PaymentProvider = typeof onlinePaymentProviders[number];
export type SubscriptionMethod = typeof subscriptionMethods[number];

export interface GatewayCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  document?: string | undefined;
}

export interface GatewayCharge {
  txid: string;
  externalId: string;
  method: "PIX_DYNAMIC" | "PIX_STATIC";
  pixQrCodeBase64: string;
  pixCopyPaste: string;
  expiresAt: Date;
}

export interface GatewayPaymentEvent {
  eventId: string;
  externalId: string;
  externalSubscriptionId?: string | undefined;
  staticQrCodeId?: string | undefined;
  reference?: string | undefined;
  amountCents: number;
  paidAt: Date;
  dueDate?: string | undefined;
  method: SubscriptionMethod;
}

export interface WebhookSignatureContext {
  resourceId: string;
  requestId: string;
}

export interface PaymentGatewayPort {
  createDynamicPixCharge(input: {
    txid: string;
    customer: GatewayCustomer;
    amountCents: number;
    dueDate: string;
    expiresAt: Date;
    shortExpiry: boolean;
    externalSubscriptionId?: string | undefined;
    pixKey: string | null;
    merchantName: string;
  }): Promise<GatewayCharge>;
  createRecurringSubscription(input: {
    reference: string;
    customer: GatewayCustomer;
    amountCents: number;
    method: SubscriptionMethod;
    firstDueDate: string;
    description: string;
    cardToken?: string | undefined;
    remoteIp?: string | undefined;
  }): Promise<{ externalSubscriptionId: string; checkoutUrl?: string | null }>;
  verifyWebhookSignature(received: string | undefined, expected: string, context?: WebhookSignatureContext): boolean;
}
