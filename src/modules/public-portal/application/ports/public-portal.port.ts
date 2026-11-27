import type { PaymentProvider } from "../../../payments/domain/payment-gateway.js";

export type CompanyPaymentProvider = "NONE" | PaymentProvider;

export interface PublicDepositPolicyDTO {
  enabled: boolean;
  depositPercentage: number;
  autoRefundHours: number;
  noShowPolicy: string;
  hasActivePaymentProvider: boolean;
}

export interface PublicCompanyProfile {
  id: string;
  companyName: string;
  slug: string;
  phone: string;
  whatsapp: string;
  timezone: string;
  currency: string;
  avatarUrl: string | null;
  description: string | null;
  address: Record<string, unknown> | null;
  appearance: {
    mode: "light" | "dark";
    locale: "pt-BR" | "es";
    palette: string;
  } | null;
  operatingDays: string | null;
  operatingSchedule: unknown;
  depositPolicy: PublicDepositPolicyDTO;
  paymentProvider: CompanyPaymentProvider;
}

export interface PublicClubPlanDTO {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  billingCycle: "MONTHLY";
  includedServiceIds: string[];
  maxMonthlyUses: number | null;
  allowedDaysOfWeek: number[] | null;
  gracePeriodDays: number;
}

export interface PublicCustomerRecord {
  id: string;
  name: string;
  phone: string;
}

export interface PublicActiveSubscriptionCoverage {
  subscriptionId: string;
  planId: string;
  planName: string;
  status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
  includedServiceIds: string[];
  allowedDaysOfWeek: number[] | null;
  maxMonthlyUses: number | null;
  usedThisPeriod: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  gracePeriodDays: number;
}

// Contrato padronizado de cobrança Pix/Checkout retornado tanto no sinal de agendamento quanto na adesão ao Clube.
export interface PublicPaymentChargeDTO {
  paymentId: string | null;
  amountCents: number;
  status: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELED";
  qrCodeBase64: string | null;
  copyPaste: string | null;
  checkoutUrl: string | null;
  expiresAt: string | null;
}

export interface PublicPaymentStatusDTO {
  paymentId: string;
  status: "PENDING" | "CONFIRMED" | "EXPIRED" | "CANCELED";
  expiresAt: string | null;
  paidAt: string | null;
}

export interface PublicPortalReadPort {
  findActiveCompanyBySlug(slug: string): Promise<PublicCompanyProfile | null>;
  listActiveClubPlans(companyId: string): Promise<PublicClubPlanDTO[]>;
  findClientByPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<PublicCustomerRecord | null>;
  upsertClientByPhone(
    companyId: string,
    input: { name: string; phone: string },
  ): Promise<PublicCustomerRecord>;
  findActiveClubCoverageByPhone(
    companyId: string,
    normalizedPhone: string,
    now: Date,
  ): Promise<PublicActiveSubscriptionCoverage | null>;
  findServicePrice(
    companyId: string,
    serviceId: string,
  ): Promise<{ id: string; priceInCents: number; active: boolean } | null>;
  cancelPendingAppointmentBestEffort(
    companyId: string,
    appointmentId: string,
    reason: string,
  ): Promise<void>;
}

export interface PublicPortalPaymentsPort {
  createDepositPix(input: {
    companyId: string;
    appointmentId: string;
    clientId: string;
    amountCents: number;
    document?: string | undefined;
  }): Promise<PublicPaymentChargeDTO>;

  enrollClubPix(input: {
    companyId: string;
    clientId: string;
    planId: string;
    document?: string | undefined;
    remoteIp?: string | undefined;
  }): Promise<{
    subscriptionId: string;
    planId: string;
    status: string;
    payment: PublicPaymentChargeDTO;
  }>;

  getPaymentStatus(
    companyId: string,
    paymentId: string,
  ): Promise<PublicPaymentStatusDTO>;
}
