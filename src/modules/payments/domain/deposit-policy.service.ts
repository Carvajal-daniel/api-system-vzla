// Serviço de domínio compartilhado que centraliza a política de sinal anti-no-show
// e a elegibilidade de assinantes do Clube VIP para Portal Público, WhatsApp IA e Agendamento Manual.

export interface TenantDepositPolicy {
  enabled: boolean;
  depositPercentage: number;
  autoRefundHours: number;
  noShowPolicy: string;
  hasActivePaymentProvider: boolean;
}

export interface ClubSubscriberSnapshot {
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
  paymentMethod?: "PIX" | "CREDIT_CARD" | null;
  paymentProvider?: string | null;
  priceCents?: number | null;
  checkoutUrl?: string | null;
}

export type DepositExemptReason =
  | "POLICY_DISABLED"
  | "ACTIVE_CLUB_SUBSCRIBER"
  | "ZERO_AMOUNT"
  | null;

export interface DepositPolicyEvaluation {
  requiresDeposit: boolean;
  depositAmountCents: number;
  exemptReason: DepositExemptReason;
}

export interface SubscriptionRenewalAlert {
  daysUntilRenewal: number | null;
  inGracePeriod: boolean;
  needsRenewalAlert: boolean;
}

const MS_PER_DAY = 86_400_000;

// Verifica se o cliente possui assinatura ativa do Clube VIP (incluindo período de tolerância válido).
export function isActiveClubSubscriber(
  subscription: Pick<
    ClubSubscriberSnapshot,
    "status" | "currentPeriodEnd" | "gracePeriodDays"
  > | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!subscription) return false;
  if (subscription.status === "ACTIVE") return true;
  if (
    (subscription.status === "PAST_DUE" || subscription.status === "SUSPENDED") &&
    subscription.currentPeriodEnd
  ) {
    const graceEndMs =
      subscription.currentPeriodEnd.getTime() + subscription.gracePeriodDays * MS_PER_DAY;
    return now.getTime() < graceEndMs;
  }
  return false;
}

// Calcula se a assinatura está próxima do vencimento (<= alertWindowDays) ou em período de tolerância.
export function evaluateSubscriptionRenewalAlert(
  subscription: Pick<
    ClubSubscriberSnapshot,
    "status" | "currentPeriodEnd" | "gracePeriodDays"
  > | null | undefined,
  now: Date = new Date(),
  alertWindowDays = 5,
): SubscriptionRenewalAlert {
  if (!subscription || !subscription.currentPeriodEnd) {
    return {
      daysUntilRenewal: null,
      inGracePeriod: subscription?.status === "PAST_DUE",
      needsRenewalAlert: subscription?.status === "PAST_DUE",
    };
  }

  const diffMs = subscription.currentPeriodEnd.getTime() - now.getTime();
  const daysUntilRenewal = Math.ceil(diffMs / MS_PER_DAY);
  const inGracePeriod =
    subscription.status === "PAST_DUE" ||
    (diffMs <= 0 &&
      now.getTime() <
        subscription.currentPeriodEnd.getTime() + subscription.gracePeriodDays * MS_PER_DAY);

  const needsRenewalAlert = inGracePeriod || daysUntilRenewal <= alertWindowDays;

  return {
    daysUntilRenewal,
    inGracePeriod,
    needsRenewalAlert,
  };
}

// Regra única de sinal anti-no-show usada por Portal Público, WhatsApp IA e Agendamento Manual:
// 1. Se a cobrança de sinal estiver desativada nas configurações da barbearia, nenhum módulo cobra sinal.
// 2. Se o cliente for assinante ativo do Clube VIP, é sempre isento de sinal — inclusive para serviços extras fora do plano.
export function evaluateDepositPolicy(input: {
  policy: Pick<TenantDepositPolicy, "enabled" | "depositPercentage">;
  isActiveSubscriber: boolean;
  servicePriceInCents: number;
}): DepositPolicyEvaluation {
  if (!input.policy.enabled || input.policy.depositPercentage <= 0) {
    return {
      requiresDeposit: false,
      depositAmountCents: 0,
      exemptReason: "POLICY_DISABLED",
    };
  }

  if (input.isActiveSubscriber) {
    return {
      requiresDeposit: false,
      depositAmountCents: 0,
      exemptReason: "ACTIVE_CLUB_SUBSCRIBER",
    };
  }

  const safePrice = Math.max(0, Math.round(input.servicePriceInCents));
  const depositAmountCents = Math.round((safePrice * input.policy.depositPercentage) / 100);

  if (depositAmountCents <= 0) {
    return {
      requiresDeposit: false,
      depositAmountCents: 0,
      exemptReason: "ZERO_AMOUNT",
    };
  }

  return {
    requiresDeposit: true,
    depositAmountCents,
    exemptReason: null,
  };
}
