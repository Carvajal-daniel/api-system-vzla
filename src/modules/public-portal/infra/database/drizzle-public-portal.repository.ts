import { and, asc, desc, eq, ne, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import {
  ClubSubscriptionTable,
  SubscriptionPlanTable,
} from "../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import {
  appearanceSchema,
  CompanySettingsTable,
  defaults,
  settingsSchema,
} from "../../../Company/infra/database/schema/company-settings-schema.js";
import type { PaymentProvider } from "../../../payments/domain/payment-gateway.js";
import { PaymentsRepository } from "../../../payments/infra/database/payments.repository.js";
import {
  ClientSubscriptionTable,
  ClubBenefitUseTable,
  CompanyPaymentConfigTable,
} from "../../../payments/infra/database/schema/payments-schema.js";
import { ServiceTable } from "../../../services/infra/database/schema/services-schema.js";
import type {
  CompanyPaymentProvider,
  PublicActiveSubscriptionCoverage,
  PublicClubPlanDTO,
  PublicCompanyProfile,
  PublicCustomerRecord,
  PublicPaymentChargeDTO,
  PublicPaymentStatusDTO,
  PublicPortalPaymentsPort,
  PublicPortalReadPort,
} from "../../application/ports/public-portal.port.js";

function isOnlineProviderOperational(provider: CompanyPaymentProvider): boolean {
  if (provider === "NONE") return false;
  if (provider === "SANDBOX") {
    return ["development", "test"].includes(process.env.NODE_ENV ?? "development");
  }
  return true;
}

// Compara telefones brasileiros de forma flexível (com/sem +55 e 10 ou 11 dígitos)
// para reconhecer clientes e assinaturas independentemente da formatação salva no banco.
function buildFlexiblePhoneMatch(column: AnyColumn, normalizedPhone: string): SQL {
  const digits = normalizedPhone.replace(/\D/g, "");
  const dbDigits = sql`REGEXP_REPLACE(${column}, '\\D', '', 'g')`;
  const conditions: SQL[] = [eq(column, normalizedPhone)];

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

function buildPhoneMatchPriority(column: AnyColumn, normalizedPhone: string): SQL {
  const digits = normalizedPhone.replace(/\D/g, "");
  const dbDigits = sql`REGEXP_REPLACE(${column}, '\\D', '', 'g')`;
  const last11 = digits.length >= 11 ? digits.slice(-11) : "";
  return sql`CASE WHEN ${column} = ${normalizedPhone} THEN 0 WHEN ${last11} <> '' AND RIGHT(${dbDigits}, 11) = ${last11} THEN 1 ELSE 2 END`;
}

export class DrizzlePublicPortalRepository implements PublicPortalReadPort {
  async findActiveCompanyBySlug(
    slug: string,
  ): Promise<PublicCompanyProfile | null> {
    const [row] = await db
      .select({
        company: CompanyTable,
        settings: CompanySettingsTable,
        paymentProvider: CompanyPaymentConfigTable.paymentProvider,
      })
      .from(CompanyTable)
      .leftJoin(
        CompanySettingsTable,
        eq(CompanySettingsTable.companyId, CompanyTable.id),
      )
      .leftJoin(
        CompanyPaymentConfigTable,
        eq(CompanyPaymentConfigTable.companyId, CompanyTable.id),
      )
      .where(and(eq(CompanyTable.slug, slug), eq(CompanyTable.isActive, true)))
      .limit(1);

    if (!row) return null;

    const preferences = row.settings?.preferences;
    const parsedSettings = settingsSchema.parse({
      ...defaults,
      ...preferences,
      clientFields: { ...defaults.clientFields, ...preferences?.clientFields },
    });

    const parsedAppearance = row.settings?.appearance
      ? appearanceSchema.parse(
          Object.assign(
            { mode: "light", locale: "pt-BR", palette: "royal" },
            row.settings.appearance,
          ),
        )
      : null;

    const provider: CompanyPaymentProvider = row.paymentProvider ?? "NONE";
    const onlinePayment = parsedSettings.onlinePayment;

    return {
      id: row.company.id,
      companyName: row.company.companyName,
      slug: row.company.slug,
      phone: row.company.phone,
      whatsapp: parsedSettings.reminders?.servicePhone || row.company.phone,
      timezone: row.company.timezone,
      currency: row.company.currency,
      avatarUrl: row.company.avatarUrl ?? null,
      description: parsedSettings.description ?? null,
      address: (parsedSettings.address as Record<string, unknown> | null) ?? null,
      appearance: parsedAppearance,
      operatingDays: row.company.operatingDays ?? null,
      operatingSchedule: row.company.operatingSchedule ?? null,
      paymentProvider: provider,
      depositPolicy: {
        enabled: Boolean(onlinePayment?.enabled),
        depositPercentage: onlinePayment?.depositPercentage ?? 0,
        autoRefundHours: onlinePayment?.autoRefundHours ?? 0,
        noShowPolicy: onlinePayment?.noShowPolicy ?? "",
        hasActivePaymentProvider: isOnlineProviderOperational(provider),
      },
    };
  }

  async listActiveClubPlans(companyId: string): Promise<PublicClubPlanDTO[]> {
    const rows = await db
      .select()
      .from(SubscriptionPlanTable)
      .where(
        and(
          eq(SubscriptionPlanTable.companyId, companyId),
          eq(SubscriptionPlanTable.active, true),
        ),
      )
      .orderBy(asc(SubscriptionPlanTable.priceCents), asc(SubscriptionPlanTable.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      priceCents: row.priceCents,
      billingCycle: row.billingCycle,
      includedServiceIds: row.includedServiceIds ?? [],
      maxMonthlyUses: row.maxMonthlyUses ?? null,
      allowedDaysOfWeek: row.allowedDaysOfWeek ?? null,
      gracePeriodDays: row.gracePeriodDays,
    }));
  }

  async findClientByPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<PublicCustomerRecord | null> {
    const [row] = await db
      .select({
        id: ClientTable.id,
        name: ClientTable.name,
        phone: ClientTable.phone,
      })
      .from(ClientTable)
      .where(
        and(
          eq(ClientTable.companyId, companyId),
          buildFlexiblePhoneMatch(ClientTable.phone, normalizedPhone),
        ),
      )
      .orderBy(buildPhoneMatchPriority(ClientTable.phone, normalizedPhone))
      .limit(1);

    return row ?? null;
  }

  async upsertClientByPhone(
    companyId: string,
    input: { name: string; phone: string },
  ): Promise<PublicCustomerRecord> {
    const existing = await this.findClientByPhone(companyId, input.phone);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const [inserted] = await db
      .insert(ClientTable)
      .values({
        companyId,
        name: input.name,
        phone: input.phone,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [ClientTable.companyId, ClientTable.phone],
      })
      .returning({
        id: ClientTable.id,
        name: ClientTable.name,
        phone: ClientTable.phone,
      });

    if (inserted) {
      return inserted;
    }

    // Em caso de corrida simultânea de upsert pelo mesmo telefone, retorna o registro criado.
    const concurrent = await this.findClientByPhone(companyId, input.phone);
    if (!concurrent) {
      throw new Error("Failed to resolve client record after upsert.");
    }
    return concurrent;
  }

  async findActiveClubCoverageByPhone(
    companyId: string,
    normalizedPhone: string,
    now: Date,
  ): Promise<PublicActiveSubscriptionCoverage | null> {
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
          buildFlexiblePhoneMatch(ClientTable.phone, normalizedPhone),
          ne(ClientSubscriptionTable.status, "PENDING_PAYMENT"),
          ne(ClientSubscriptionTable.status, "CANCELED"),
        ),
      )
      .orderBy(
        buildPhoneMatchPriority(ClientTable.phone, normalizedPhone),
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
      };
    }

    // Fallback para tabela legada club_subscriptions (mantém paridade com DrizzleAppointmentsRepository).
    const [legacy] = await db
      .select({
        status: ClubSubscriptionTable.status,
        dueAt: ClubSubscriptionTable.dueAt,
        planId: SubscriptionPlanTable.id,
        planName: SubscriptionPlanTable.name,
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
          buildFlexiblePhoneMatch(ClubSubscriptionTable.clientPhone, normalizedPhone),
          ne(ClubSubscriptionTable.status, "CANCELED"),
        ),
      )
      .orderBy(buildPhoneMatchPriority(ClubSubscriptionTable.clientPhone, normalizedPhone))
      .limit(1);

    if (!legacy) return null;

    return {
      subscriptionId: `legacy:${companyId}:${normalizedPhone}`,
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
    };
  }

  async findServicePrice(
    companyId: string,
    serviceId: string,
  ): Promise<{ id: string; priceInCents: number; active: boolean } | null> {
    const [row] = await db
      .select({
        id: ServiceTable.id,
        priceInCents: ServiceTable.priceInCents,
        active: ServiceTable.active,
      })
      .from(ServiceTable)
      .where(
        and(
          eq(ServiceTable.companyId, companyId),
          eq(ServiceTable.id, serviceId),
        ),
      )
      .limit(1);

    return row ?? null;
  }

  async cancelPendingAppointmentBestEffort(
    companyId: string,
    appointmentId: string,
    reason: string,
  ): Promise<void> {
    try {
      await db
        .update(AppointmentTable)
        .set({
          status: "CANCELED",
          cancellationReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(AppointmentTable.companyId, companyId),
            eq(AppointmentTable.id, appointmentId),
            eq(AppointmentTable.status, "PENDING"),
          ),
        );
    } catch {
      // Melhor esforço: não mascarar o erro original do gateway de pagamento.
    }
  }
}

export class PaymentsRepositoryPublicAdapter implements PublicPortalPaymentsPort {
  constructor(private readonly paymentsRepository: PaymentsRepository) {}

  async createDepositPix(input: {
    companyId: string;
    appointmentId: string;
    clientId: string;
    amountCents: number;
    document?: string | undefined;
  }): Promise<PublicPaymentChargeDTO> {
    const charge = await this.paymentsRepository.createPix(input.companyId, {
      referenceType: "APPOINTMENT_DEPOSIT",
      referenceId: input.appointmentId,
      clientId: input.clientId,
      amountCents: input.amountCents,
      document: input.document,
    });

    return {
      paymentId: charge.id,
      amountCents: charge.amountCents,
      status: charge.status,
      qrCodeBase64: charge.pixQrCodeBase64 ?? null,
      copyPaste: charge.pixCopyPaste ?? null,
      checkoutUrl: null,
      expiresAt: charge.expiresAt ? charge.expiresAt.toISOString() : null,
    };
  }

  async enrollClubPix(input: {
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
  }> {
    const subscription = await this.paymentsRepository.enroll(input.companyId, {
      clientId: input.clientId,
      planId: input.planId,
      paymentMethod: "PIX",
      document: input.document,
      remoteIp: input.remoteIp,
    });

    if (subscription.paymentProvider === "MERCADO_PAGO") {
      return {
        subscriptionId: subscription.id,
        planId: subscription.planId,
        status: subscription.status,
        payment: {
          paymentId: null,
          amountCents: subscription.priceCents,
          status: "PENDING",
          qrCodeBase64: null,
          copyPaste: null,
          checkoutUrl: subscription.checkoutUrl ?? null,
          expiresAt: null,
        },
      };
    }

    const charge = await this.paymentsRepository.createPix(input.companyId, {
      referenceType: "SUBSCRIPTION",
      referenceId: subscription.id,
      clientId: input.clientId,
      document: input.document,
    });

    return {
      subscriptionId: subscription.id,
      planId: subscription.planId,
      status: subscription.status,
      payment: {
        paymentId: charge.id,
        amountCents: charge.amountCents,
        status: charge.status,
        qrCodeBase64: charge.pixQrCodeBase64 ?? null,
        copyPaste: charge.pixCopyPaste ?? null,
        checkoutUrl: subscription.checkoutUrl ?? null,
        expiresAt: charge.expiresAt ? charge.expiresAt.toISOString() : null,
      },
    };
  }

  async getPaymentStatus(
    companyId: string,
    paymentId: string,
  ): Promise<PublicPaymentStatusDTO> {
    const result = await this.paymentsRepository.status(companyId, paymentId);
    return {
      paymentId: result.id,
      status: result.status,
      expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
      paidAt: result.paidAt ? result.paidAt.toISOString() : null,
    };
  }
}
