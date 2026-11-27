import { and, desc, eq, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import {
  ClubSubscriptionTable,
  SubscriptionPlanTable,
} from "../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { CompanySettingsTable } from "../../../Company/infra/database/schema/company-settings-schema.js";
import {
  evaluateDepositPolicy,
  isActiveClubSubscriber,
  type ClubSubscriberSnapshot,
  type DepositPolicyEvaluation,
  type TenantDepositPolicy,
} from "../../domain/deposit-policy.service.js";
import {
  ClientSubscriptionTable,
  ClubBenefitUseTable,
  CompanyPaymentConfigTable,
} from "./schema/payments-schema.js";

function isOnlineProviderOperational(
  provider: "NONE" | "ASAAS" | "MERCADO_PAGO" | "SANDBOX",
): boolean {
  if (provider === "NONE") return false;
  if (provider === "SANDBOX") {
    return ["development", "test"].includes(process.env.NODE_ENV ?? "development");
  }
  return true;
}

// Compara telefones brasileiros de forma flexível (com/sem +55 e últimos 10 ou 11 dígitos)
// para reconhecer clientes e assinantes independentemente do formato salvo.
export function buildFlexiblePhoneMatch(column: AnyColumn, rawPhone: string): SQL {
  const digits = rawPhone.replace(/\D/g, "");
  const dbDigits = sql`REGEXP_REPLACE(${column}, '\\D', '', 'g')`;
  const conditions: SQL[] = [eq(column, rawPhone)];

  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    conditions.push(sql`RIGHT(${dbDigits}, 10) = ${last10}`);
  }

  if (digits.length >= 11) {
    const last11 = digits.slice(-11);
    conditions.push(sql`RIGHT(${dbDigits}, 11) = ${last11}`);
  }

  return or(...conditions)!;
}

export function buildPhoneMatchPriority(column: AnyColumn, rawPhone: string): SQL {
  const digits = rawPhone.replace(/\D/g, "");
  const dbDigits = sql`REGEXP_REPLACE(${column}, '\\D', '', 'g')`;
  const last11 = digits.length >= 11 ? digits.slice(-11) : "";
  return sql`CASE WHEN ${column} = ${rawPhone} THEN 0 WHEN ${last11} <> '' AND RIGHT(${dbDigits}, 11) = ${last11} THEN 1 ELSE 2 END`;
}

// Lê a política global de sinal anti-no-show da empresa e verifica se há gateway operacional.
export async function loadTenantDepositPolicy(
  companyId: string,
): Promise<TenantDepositPolicy> {
  const [[settingsRow], [paymentConfig]] = await Promise.all([
    db
      .select({ preferences: CompanySettingsTable.preferences })
      .from(CompanySettingsTable)
      .where(eq(CompanySettingsTable.companyId, companyId))
      .limit(1),
    db
      .select({ paymentProvider: CompanyPaymentConfigTable.paymentProvider })
      .from(CompanyPaymentConfigTable)
      .where(eq(CompanyPaymentConfigTable.companyId, companyId))
      .limit(1),
  ]);

  const onlinePayment = settingsRow?.preferences?.onlinePayment;
  const provider = paymentConfig?.paymentProvider ?? "NONE";

  return {
    enabled: Boolean(onlinePayment?.enabled),
    depositPercentage: onlinePayment?.depositPercentage ?? 0,
    autoRefundHours: onlinePayment?.autoRefundHours ?? 24,
    noShowPolicy: onlinePayment?.noShowPolicy ?? "",
    hasActivePaymentProvider: isOnlineProviderOperational(provider),
  };
}

// Localiza a assinatura ativa (ou em tolerância) do cliente pelo telefone usando matching flexível de 10/11 dígitos.
export async function findActiveClubSubscriptionByPhone(
  companyId: string,
  rawPhone: string,
  now: Date = new Date(),
): Promise<ClubSubscriberSnapshot | null> {
  const digits = rawPhone.replace(/\D/g, "");
  if (digits.length < 10) return null;

  const [current] = await db
    .select({
      subscription: ClientSubscriptionTable,
      plan: SubscriptionPlanTable,
    })
    .from(ClientSubscriptionTable)
    .innerJoin(
      ClientTable,
      and(
        eq(ClientTable.companyId, companyId),
        eq(ClientTable.id, ClientSubscriptionTable.clientId),
      ),
    )
    .innerJoin(
      SubscriptionPlanTable,
      and(
        eq(SubscriptionPlanTable.companyId, companyId),
        eq(SubscriptionPlanTable.id, ClientSubscriptionTable.planId),
      ),
    )
    .where(
      and(
        eq(ClientSubscriptionTable.companyId, companyId),
        buildFlexiblePhoneMatch(ClientTable.phone, rawPhone),
        ne(ClientSubscriptionTable.status, "PENDING_PAYMENT"),
        ne(ClientSubscriptionTable.status, "CANCELED"),
      ),
    )
    .orderBy(
      buildPhoneMatchPriority(ClientTable.phone, rawPhone),
      desc(ClientSubscriptionTable.currentPeriodEnd),
    )
    .limit(1);

  if (current) {
    const { subscription, plan } = current;
    const dueAt = subscription.currentPeriodEnd;
    const effectiveStatus =
      subscription.status === "ACTIVE" && dueAt && dueAt <= now
        ? "PAST_DUE"
        : (subscription.status as "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED");

    let usedThisPeriod = 0;
    if (plan.maxMonthlyUses !== null && subscription.currentPeriodStart) {
      const [usage] = await db
        .select({
          used: sql<number>`coalesce(sum(${ClubBenefitUseTable.quantity}), 0)`.mapWith(Number),
        })
        .from(ClubBenefitUseTable)
        .where(
          and(
            eq(ClubBenefitUseTable.subscriptionId, subscription.id),
            eq(ClubBenefitUseTable.periodStart, subscription.currentPeriodStart),
          ),
        );
      usedThisPeriod = usage?.used ?? 0;
    }

    return {
      subscriptionId: subscription.id,
      planId: plan.id,
      planName: plan.name,
      status: effectiveStatus,
      includedServiceIds: plan.includedServiceIds ?? [],
      allowedDaysOfWeek: plan.allowedDaysOfWeek ?? null,
      maxMonthlyUses: plan.maxMonthlyUses ?? null,
      usedThisPeriod,
      currentPeriodStart: subscription.currentPeriodStart ?? null,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      gracePeriodDays: plan.gracePeriodDays,
      paymentMethod: subscription.paymentMethod,
      paymentProvider: subscription.paymentProvider,
      priceCents: subscription.priceCents,
      checkoutUrl: subscription.checkoutUrl ?? null,
    };
  }

  // Fallback para tabela legada club_subscriptions.
  const [legacy] = await db
    .select({
      status: ClubSubscriptionTable.status,
      dueAt: ClubSubscriptionTable.dueAt,
      planId: SubscriptionPlanTable.id,
      planName: SubscriptionPlanTable.name,
      priceCents: SubscriptionPlanTable.priceCents,
      includedServiceIds: SubscriptionPlanTable.includedServiceIds,
      allowedDaysOfWeek: SubscriptionPlanTable.allowedDaysOfWeek,
      maxMonthlyUses: SubscriptionPlanTable.maxMonthlyUses,
      gracePeriodDays: SubscriptionPlanTable.gracePeriodDays,
    })
    .from(ClubSubscriptionTable)
    .innerJoin(
      SubscriptionPlanTable,
      and(
        eq(SubscriptionPlanTable.companyId, ClubSubscriptionTable.companyId),
        eq(SubscriptionPlanTable.id, ClubSubscriptionTable.planId),
      ),
    )
    .where(
      and(
        eq(ClubSubscriptionTable.companyId, companyId),
        buildFlexiblePhoneMatch(ClubSubscriptionTable.clientPhone, rawPhone),
        ne(ClubSubscriptionTable.status, "CANCELED"),
      ),
    )
    .orderBy(buildPhoneMatchPriority(ClubSubscriptionTable.clientPhone, rawPhone))
    .limit(1);

  if (!legacy) return null;

  return {
    subscriptionId: `legacy:${companyId}:${digits}`,
    planId: legacy.planId,
    planName: legacy.planName,
    status: legacy.status,
    includedServiceIds: legacy.includedServiceIds ?? [],
    allowedDaysOfWeek: legacy.allowedDaysOfWeek ?? null,
    maxMonthlyUses: legacy.maxMonthlyUses ?? null,
    usedThisPeriod: 0,
    currentPeriodStart: null,
    currentPeriodEnd: legacy.dueAt ?? null,
    gracePeriodDays: legacy.gracePeriodDays,
    priceCents: legacy.priceCents,
  };
}

// Helper unificado para avaliar se um agendamento exige sinal anti-no-show considerando
// a configuração da barbearia e a isenção total para assinantes ativos do Clube VIP.
export async function evaluateTenantDepositForClient(input: {
  companyId: string;
  clientPhone: string;
  servicePriceInCents: number;
  now?: Date;
}): Promise<{
  policy: TenantDepositPolicy;
  subscription: ClubSubscriberSnapshot | null;
  isActiveSubscriber: boolean;
  evaluation: DepositPolicyEvaluation;
}> {
  const now = input.now ?? new Date();
  const [policy, subscription] = await Promise.all([
    loadTenantDepositPolicy(input.companyId),
    findActiveClubSubscriptionByPhone(input.companyId, input.clientPhone, now),
  ]);
  const isActiveSubscriber = isActiveClubSubscriber(subscription, now);
  const evaluation = evaluateDepositPolicy({
    policy,
    isActiveSubscriber,
    servicePriceInCents: input.servicePriceInCents,
  });

  return {
    policy,
    subscription,
    isActiveSubscriber,
    evaluation,
  };
}
