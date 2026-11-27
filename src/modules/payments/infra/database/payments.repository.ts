
import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "../../../../shared/database/database.js";
import { PaymentError } from "../../domain/payment-policy.js";
import { CompanyTable } from "../../../Company/infra/database/schema/companies-schema.js";
import { ServiceTable } from "../../../services/infra/database/schema/services-schema.js";
import { ClientTable } from "../../../clients/infra/database/schema/clients-schema.js";
import { AppointmentTable } from "../../../appointments/infra/database/schema/appointments-schema.js";
import { SubscriptionPlanTable } from "../../../appointments/infra/database/schema/subscription-plans-schema.js";
import { getLocalDateTimeParts, localDateTimeToUtc, parseLocalDateString } from "../../../appointments/domain/services/timezone-utils.js";
import { hasOnlineOrderForAppointment } from "../../../finance/infra/database/repositories/online-order.js";
import { FinancialDocumentTable, ReceiptTable } from "../../../finance/infra/database/schema/collections-schema.js";
import { FinanceOrderPaymentTable, FinanceOrderTable } from "../../../finance/infra/database/schema/orders-schema.js";
import type { ChargeReference, GatewayPaymentEvent, PaymentGatewayPort, PaymentProvider, SubscriptionMethod, WebhookSignatureContext } from "../../domain/payment-gateway.js";
import { missingPaymentResource, nextMonthlyDate, paymentConflict } from "../../domain/payment-policy.js";
import { AsaasPaymentAdapter } from "../gateways/asaas-payment.adapter.js";
import { MercadoPagoPaymentAdapter, mercadoPagoPayerEmail, type MercadoPagoWebhookTopic } from "../gateways/mercado-pago-payment.adapter.js";
import { decryptPaymentSecret, encryptPaymentSecret } from "../gateways/payment-secrets.js";
import { encodePixCode } from "../gateways/pix-code.js";
import { SandboxPaymentAdapter } from "../gateways/sandbox-payment.adapter.js";
import { ClientSubscriptionTable, CompanyPaymentConfigTable, PaymentChargeTable, PaymentWebhookEventTable } from "./schema/payments-schema.js";

export type PaymentTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PlanFields = Omit<typeof SubscriptionPlanTable.$inferInsert, "id" | "companyId">;
type Subscription = typeof ClientSubscriptionTable.$inferSelect;
type Config = typeof CompanyPaymentConfigTable.$inferSelect;

const localDay = (now: Date, timezone: string) => getLocalDateTimeParts(now, timezone).dateString;
function localMidnight(date: string, timezone: string) {
  const { year, month, day } = parseLocalDateString(date);
  return localDateTimeToUtc(year, month, day, 0, 0, timezone);
}
const sandbox = new SandboxPaymentAdapter();

function sandboxAllowed() {
  return ["development", "test"].includes(process.env.NODE_ENV ?? "development");
}

function gateway(config: Config): PaymentGatewayPort {
  if (config.paymentProvider === "SANDBOX" && sandboxAllowed()) return sandbox;
  if (config.paymentProvider === "ASAAS" && config.providerApiKeyEncrypted) {
    return new AsaasPaymentAdapter(decryptPaymentSecret(config.providerApiKeyEncrypted));
  }
  if (config.paymentProvider === "MERCADO_PAGO" && config.providerApiKeyEncrypted) {
    return new MercadoPagoPaymentAdapter(decryptPaymentSecret(config.providerApiKeyEncrypted));
  }
  throw paymentConflict("PAYMENT_PROVIDER_UNAVAILABLE", "Configure um provedor de pagamentos ativo.");
}

async function lockTenant(tx: PaymentTransaction, companyId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"club-snapshot:" + companyId}))`);
}

async function tenant(tx: PaymentTransaction, companyId: string) {
  const [company] = await tx.select().from(CompanyTable).where(eq(CompanyTable.id, companyId));
  if (!company) throw missingPaymentResource("COMPANY_NOT_FOUND");
  return company;
}

async function configuration(tx: PaymentTransaction, companyId: string): Promise<Config> {
  const [config] = await tx.select().from(CompanyPaymentConfigTable).where(eq(CompanyPaymentConfigTable.companyId, companyId));
  return config ?? { companyId, paymentProvider: "NONE", providerApiKeyEncrypted: null, webhookTokenEncrypted: null, staticPixKey: null };
}

async function clientFor(tx: PaymentTransaction, companyId: string, clientId: string) {
  const [client] = await tx.select().from(ClientTable).where(and(eq(ClientTable.companyId, companyId), eq(ClientTable.id, clientId)));
  if (!client) throw missingPaymentResource("PAYMENT_CLIENT_NOT_FOUND");
  return client;
}

async function assertServices(tx: PaymentTransaction, companyId: string, ids: string[]) {
  if (ids.length === 0) return;
  const services = await tx.select({ id: ServiceTable.id }).from(ServiceTable)
    .where(and(eq(ServiceTable.companyId, companyId), inArray(ServiceTable.id, ids)));
  if (services.length !== ids.length) throw missingPaymentResource("PLAN_SERVICE_NOT_FOUND");
}

async function refreshOverdue(tx: PaymentTransaction, companyId: string, today: Date) {
  await tx.execute(sql`
    UPDATE client_subscriptions AS cs
    SET status = CASE WHEN cs.current_period_end + sp.grace_period_days * interval '24 hours' <= ${today}
      THEN 'SUSPENDED' ELSE 'PAST_DUE' END
    FROM subscription_plans AS sp
    WHERE cs.company_id = ${companyId} AND sp.company_id = cs.company_id AND sp.id = cs.plan_id
      AND cs.current_period_end <= ${today}
      AND (cs.status = 'ACTIVE' OR (cs.status = 'PAST_DUE' AND cs.current_period_end + sp.grace_period_days * interval '24 hours' <= ${today}))
  `);
}

export class PaymentsRepository {
  listPlans(companyId: string) {
    return db.select().from(SubscriptionPlanTable).where(eq(SubscriptionPlanTable.companyId, companyId)).orderBy(SubscriptionPlanTable.name);
  }

  writePlan(companyId: string, fields: { [K in keyof PlanFields]?: PlanFields[K] | undefined }, id?: string) {
    return db.transaction(async (tx) => {
      if (fields.includedServiceIds) await assertServices(tx, companyId, fields.includedServiceIds);
      const [plan] = id
        ? await tx.update(SubscriptionPlanTable).set(fields).where(and(eq(SubscriptionPlanTable.companyId, companyId), eq(SubscriptionPlanTable.id, id))).returning()
        : await tx.insert(SubscriptionPlanTable).values({ ...fields, companyId, name: fields.name! }).returning();
      if (!plan) throw missingPaymentResource("SUBSCRIPTION_PLAN_NOT_FOUND");
      return plan;
    });
  }

  listSubscriptions(companyId: string, status?: Subscription["status"]) {
    return db.transaction(async (tx) => {
      await lockTenant(tx, companyId);
      await refreshOverdue(tx, companyId, new Date());
      return tx.select({ subscription: ClientSubscriptionTable, clientName: ClientTable.name, planName: SubscriptionPlanTable.name })
        .from(ClientSubscriptionTable)
        .innerJoin(ClientTable, and(eq(ClientTable.companyId, companyId), eq(ClientTable.id, ClientSubscriptionTable.clientId)))
        .innerJoin(SubscriptionPlanTable, and(eq(SubscriptionPlanTable.companyId, companyId), eq(SubscriptionPlanTable.id, ClientSubscriptionTable.planId)))
        .where(and(eq(ClientSubscriptionTable.companyId, companyId), status ? eq(ClientSubscriptionTable.status, status) : undefined))
        .orderBy(ClientTable.name);
    });
  }

  async enroll(companyId: string, input: {
    clientId: string; planId: string; paymentMethod: SubscriptionMethod;
    document?: string | undefined; cardToken?: string | undefined; remoteIp?: string | undefined;
  }) {
    const reserved = await db.transaction(async (tx) => {
      await lockTenant(tx, companyId);
      const config = await configuration(tx, companyId);
      const provider = gateway(config);
      const company = await tenant(tx, companyId);
      if (company.currency !== "BRL") throw paymentConflict("PAYMENT_CURRENCY_UNSUPPORTED", "Pagamentos online usam BRL.");
      const client = await clientFor(tx, companyId, input.clientId);
      const [plan] = await tx.select().from(SubscriptionPlanTable).where(and(
        eq(SubscriptionPlanTable.companyId, companyId), eq(SubscriptionPlanTable.id, input.planId), eq(SubscriptionPlanTable.active, true),
      ));
      if (config.paymentProvider === "MERCADO_PAGO") mercadoPagoPayerEmail(client);
      if (!plan || plan.priceCents < 1) throw missingPaymentResource("SUBSCRIPTION_PLAN_NOT_AVAILABLE");

      const [existing] = await tx.select().from(ClientSubscriptionTable).where(and(
        eq(ClientSubscriptionTable.companyId, companyId), eq(ClientSubscriptionTable.clientId, client.id),
        ne(ClientSubscriptionTable.status, "CANCELED"),
      ));
      if (existing) {
        if (existing.planId !== plan.id || existing.paymentMethod !== input.paymentMethod || existing.paymentProvider !== config.paymentProvider) {
          throw paymentConflict("SUBSCRIPTION_ALREADY_EXISTS", "O cliente já possui uma assinatura.");
        }
        return { subscription: existing, provider, client, plan };
      }
      const [subscription] = await tx.insert(ClientSubscriptionTable).values({
        companyId, clientId: client.id, planId: plan.id, paymentMethod: input.paymentMethod,
        paymentProvider: config.paymentProvider as PaymentProvider, priceCents: plan.priceCents,
        nextBillingDate: localDay(new Date(), company.timezone),
      }).returning();
      return { subscription: subscription!, provider, client, plan };
    });

    if (reserved.subscription.externalSubscriptionId) return reserved.subscription;
    return db.transaction(async (tx) => {
      const [subscription] = await tx.select().from(ClientSubscriptionTable)
        .where(eq(ClientSubscriptionTable.id, reserved.subscription.id)).for("update");
      if (!subscription) throw missingPaymentResource("CLIENT_SUBSCRIPTION_NOT_FOUND");
      if (subscription.externalSubscriptionId) return subscription;
      const result = await reserved.provider.createRecurringSubscription({
        reference: subscription.id, customer: { ...reserved.client, document: input.document },
        amountCents: subscription.priceCents, method: subscription.paymentMethod,
        firstDueDate: subscription.nextBillingDate, description: reserved.plan.name,
        cardToken: input.cardToken, remoteIp: input.remoteIp,
      });
      const [updated] = await tx.update(ClientSubscriptionTable).set(result)
        .where(eq(ClientSubscriptionTable.id, subscription.id)).returning();
      return updated!;
    });
  }

  async getConfig(companyId: string) {
    return db.transaction(async (tx) => this.publicConfig(await configuration(tx, companyId)));
  }

  private publicConfig(config: Config) {
    return {
      paymentProvider: config.paymentProvider, staticPixKey: config.staticPixKey,
      hasProviderApiKey: !!config.providerApiKeyEncrypted, hasWebhookToken: !!config.webhookTokenEncrypted,
      ...(config.paymentProvider === "MERCADO_PAGO"
        ? { webhookPath: "/webhooks/payments/mercado-pago?companyId=" + config.companyId }
        : {}),
    };
  }

  configure(companyId: string, input: {
    paymentProvider: Config["paymentProvider"]; providerApiKey?: string | undefined;
    webhookToken?: string | undefined; staticPixKey?: string | null | undefined;
  }) {
    return db.transaction(async (tx) => {
      await lockTenant(tx, companyId);
      const previous = await configuration(tx, companyId);
      const sameProvider = input.paymentProvider === previous.paymentProvider;
      const credential = input.providerApiKey ? encryptPaymentSecret(input.providerApiKey) : sameProvider ? previous.providerApiKeyEncrypted : null;
      const webhook = input.webhookToken ? encryptPaymentSecret(input.webhookToken) : sameProvider ? previous.webhookTokenEncrypted : null;
      if (input.paymentProvider === "ASAAS" && (!credential || !webhook)) {
        throw new PaymentError("Informe a chave da API e o token exclusivo do webhook.", "VALIDATION", "ASAAS_CREDENTIALS_REQUIRED");
      }
      if (input.paymentProvider === "MERCADO_PAGO" && (!credential || !webhook)) {
        throw new PaymentError("Informe o Access Token e a chave secreta do webhook do Mercado Pago.", "VALIDATION", "MERCADO_PAGO_CREDENTIALS_REQUIRED");
      }
      if (input.paymentProvider === "SANDBOX" && !sandboxAllowed()) {
        throw paymentConflict("SANDBOX_DISABLED", "O sandbox está indisponível neste ambiente.");
      }
      if (input.paymentProvider !== previous.paymentProvider || input.providerApiKey) {
        const [subscription] = await tx.select({ id: ClientSubscriptionTable.id }).from(ClientSubscriptionTable)
          .where(and(eq(ClientSubscriptionTable.companyId, companyId), ne(ClientSubscriptionTable.status, "CANCELED"))).limit(1);
        const [charge] = await tx.select({ id: PaymentChargeTable.id }).from(PaymentChargeTable)
          .where(and(eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.status, "PENDING"), ne(PaymentChargeTable.paymentProvider, "NONE"))).limit(1);
        if (subscription || charge) throw paymentConflict("PAYMENT_PROVIDER_IN_USE", "Existem assinaturas ou cobranças em andamento.");
      }
      const config = {
        companyId, paymentProvider: input.paymentProvider, staticPixKey: input.staticPixKey === undefined ? previous.staticPixKey : input.staticPixKey,
        providerApiKeyEncrypted: credential, webhookTokenEncrypted: webhook,
      };
      await tx.insert(CompanyPaymentConfigTable).values(config).onConflictDoUpdate({
        target: CompanyPaymentConfigTable.companyId, set: config,
      });
      return this.publicConfig(config);
    });
  }

  async createPix(companyId: string, input: {
    referenceType: ChargeReference; referenceId: string; clientId: string;
    amountCents?: number | undefined; document?: string | undefined;
  }) {
    const reserved = await db.transaction(async (tx) => {
      await lockTenant(tx, companyId);
      const now = new Date();
      const company = await tenant(tx, companyId);
      const config = await configuration(tx, companyId);
      if (company.currency !== "BRL") throw paymentConflict("PAYMENT_CURRENCY_UNSUPPORTED", "Pagamentos online usam BRL.");
      const client = await clientFor(tx, companyId, input.clientId);
      if (config.paymentProvider === "MERCADO_PAGO") {
        if (input.referenceType === "APPOINTMENT_DEPOSIT") {
          throw paymentConflict("MERCADO_PAGO_DEPOSIT_EXPIRY_UNSUPPORTED", "O Pix do Mercado Pago tem validade mínima de 30 minutos.");
        }
        mercadoPagoPayerEmail(client);
      }
      const ref = await this.referenceAmount(tx, companyId, input, client.phone, now);
      const filters = and(eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.referenceType, input.referenceType), eq(PaymentChargeTable.referenceId, input.referenceId));
      const [pending] = await tx.select().from(PaymentChargeTable).where(and(filters, eq(PaymentChargeTable.status, "PENDING"))).for("update");
      let expirable = false;
      if (pending?.expiresAt && pending.expiresAt <= now) {
        if (pending.paymentProvider === "MERCADO_PAGO") {
          // A payment approved just before expiry may still be waiting for its webhook.
          expirable = !!pending.externalId && !!config.providerApiKeyEncrypted &&
            await new MercadoPagoPaymentAdapter(decryptPaymentSecret(config.providerApiKeyEncrypted)).isPixCanceled(pending.externalId);
        } else {
          expirable = pending.paymentProvider !== "ASAAS" || pending.method === "PIX_STATIC";
        }
      }
      if (pending && !expirable) {
        if (pending.clientId !== client.id || pending.amountCents !== ref.amountCents) {
          throw paymentConflict("PAYMENT_CHARGE_EXISTS", "Já existe uma cobrança para esta referência.");
        }
        return { charge: pending, company, config, client, ref };
      }
      if (pending) await tx.update(PaymentChargeTable).set({ status: "EXPIRED" }).where(eq(PaymentChargeTable.id, pending.id));
      if (config.paymentProvider === "NONE" && (!config.staticPixKey || input.referenceType !== "ORDER")) {
        throw paymentConflict("PAYMENT_PROVIDER_UNAVAILABLE", "Configure um provedor de pagamentos ativo.");
      }
      if (config.paymentProvider !== "NONE") gateway(config);
      const [charge] = await tx.insert(PaymentChargeTable).values({
        companyId, referenceType: input.referenceType, referenceId: input.referenceId,
        clientId: client.id, amountCents: ref.amountCents, paymentProvider: config.paymentProvider,
        txid: randomUUID(), method: config.paymentProvider === "NONE" ||
          (config.paymentProvider === "ASAAS" && input.referenceType === "APPOINTMENT_DEPOSIT") ? "PIX_STATIC" : "PIX_DYNAMIC",
        expiresAt: new Date(now.getTime() + (input.referenceType === "APPOINTMENT_DEPOSIT" ? 900_000 : 86_400_000)),
      }).returning();
      return { charge: charge!, company, config, client, ref };
    });
    return db.transaction(async (tx) => {
      const [charge] = await tx.select().from(PaymentChargeTable).where(eq(PaymentChargeTable.id, reserved.charge.id)).for("update");
      if (!charge) throw missingPaymentResource("PAYMENT_CHARGE_NOT_FOUND");
      if (charge.status !== "PENDING") return charge;
      if (charge.expiresAt && charge.expiresAt <= new Date()) {
        throw paymentConflict("PAYMENT_CHARGE_EXPIRED", "Esta cobrança já expirou.");
      }
      if (charge.pixCopyPaste) return charge;
      const { config, company, client, ref } = reserved;
      const qr = config.paymentProvider === "NONE"
        ? await encodePixCode(config.staticPixKey!, company.companyName, charge.amountCents, charge.txid)
        : await gateway(config).createDynamicPixCharge({
          txid: charge.txid, customer: { ...client, document: input.document },
          amountCents: charge.amountCents, dueDate: ref.dueDate ?? localDay(new Date(), company.timezone),
          expiresAt: charge.expiresAt!, shortExpiry: input.referenceType === "APPOINTMENT_DEPOSIT",
          pixKey: config.staticPixKey, merchantName: company.companyName, externalSubscriptionId: ref.externalSubscriptionId,
        });
      const [updated] = await tx.update(PaymentChargeTable).set(qr).where(eq(PaymentChargeTable.id, charge.id)).returning();
      return updated!;
    });
  }

  private async referenceAmount(tx: PaymentTransaction, companyId: string, input: {
    referenceType: ChargeReference; referenceId: string; clientId: string; amountCents?: number | undefined;
  }, phone: string, now: Date): Promise<{ amountCents: number; dueDate?: string; externalSubscriptionId?: string }> {
    if (input.referenceType === "ORDER") {
      const [order] = await tx.select().from(FinanceOrderTable).where(and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, input.referenceId))).for("update");
      if (!order) throw missingPaymentResource("FINANCE_ORDER_NOT_FOUND");
      if (order.status !== "OPEN" || order.totalCents <= order.paidCents ||
        (order.clientPhone && order.clientPhone.replace(/\D/g, "") !== phone.replace(/\D/g, ""))) {
        throw paymentConflict("ORDER_NOT_PAYABLE", "A comanda não está disponível para cobrança deste cliente.");
      }
      if (order.appointmentId) {
        const [appointment] = await tx.select({ clientPhone: AppointmentTable.clientPhone }).from(AppointmentTable)
          .where(and(eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, order.appointmentId))).for("update");
        if (!appointment || appointment.clientPhone.replace(/\D/g, "") !== phone.replace(/\D/g, "")) {
          throw paymentConflict("ORDER_CLIENT_MISMATCH", "O cliente não corresponde ao agendamento da comanda.");
        }
        const [state] = await tx.select({
          linkedCharge: hasOnlineOrderForAppointment(companyId, order.appointmentId, true, order.id),
          legacyReceipt: sql<boolean>`exists (
            select 1 from ${FinancialDocumentTable} d
            where d.company_id = ${companyId} and d.appointment_id = ${order.appointmentId} and
              (d.commission_paid_at is not null or exists (
                select 1 from ${ReceiptTable} r where r.company_id = d.company_id and r.document_id = d.id
                group by r.document_id having sum(case when r.reverses_receipt_id is null then r.amount_in_cents else -r.amount_in_cents end) > 0
              ))
          )`,
        }).from(AppointmentTable).where(eq(AppointmentTable.id, order.appointmentId));
        if (state?.linkedCharge || state?.legacyReceipt) {
          throw paymentConflict("APPOINTMENT_ALREADY_COLLECTED", "Já há recebimento ou outra cobrança para este agendamento.");
        }
      }
      return { amountCents: order.totalCents - order.paidCents };
    }

    if (input.referenceType === "SUBSCRIPTION") {
      const [subscription] = await tx.select().from(ClientSubscriptionTable).where(and(
        eq(ClientSubscriptionTable.companyId, companyId), eq(ClientSubscriptionTable.id, input.referenceId), eq(ClientSubscriptionTable.clientId, input.clientId),
      )).for("update");
      if (!subscription) throw missingPaymentResource("CLIENT_SUBSCRIPTION_NOT_FOUND");
      if (subscription.paymentProvider === "MERCADO_PAGO") {
        throw paymentConflict("MERCADO_PAGO_SUBSCRIPTION_USE_CHECKOUT", "Use o checkout da assinatura no Mercado Pago.");
      }
      if (subscription.paymentMethod !== "PIX" || subscription.status === "CANCELED" || !subscription.externalSubscriptionId ||
        (subscription.currentPeriodEnd && subscription.currentPeriodEnd > now)) {
        throw paymentConflict("SUBSCRIPTION_NOT_PAYABLE", "A assinatura não possui ciclo em aberto para Pix.");
      }
      return { amountCents: subscription.priceCents, dueDate: subscription.nextBillingDate, externalSubscriptionId: subscription.externalSubscriptionId };
    }

    const [appointment] = await tx.select().from(AppointmentTable).where(and(eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, input.referenceId))).for("update");
    if (!appointment) throw missingPaymentResource("APPOINTMENT_NOT_FOUND");
    if (appointment.status !== "PENDING" || appointment.startsAt.getTime() < now.getTime() + 900_000 ||
      appointment.clientPhone !== phone || !input.amountCents || input.amountCents > appointment.servicePriceInCentsSnapshot) {
      throw paymentConflict("DEPOSIT_NOT_PAYABLE", "Informe um sinal válido para a pré-reserva deste cliente.");
    }
    return { amountCents: input.amountCents };
  }

  async status(companyId: string, id: string) {
    const [result] = await db.select({ id: PaymentChargeTable.id, status: PaymentChargeTable.status,
      expiresAt: PaymentChargeTable.expiresAt, paidAt: PaymentChargeTable.paidAt,
    }).from(PaymentChargeTable).where(and(eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.id, id)));
    if (!result) throw missingPaymentResource("PAYMENT_CHARGE_NOT_FOUND");
    const expired = result.status === "PENDING" && result.expiresAt && result.expiresAt <= new Date();
    return { ...result, status: expired ? "EXPIRED" : result.status };
  }

  async simulate(companyId: string, id: string) {
    if (!sandboxAllowed()) throw missingPaymentResource("PAYMENT_CHARGE_NOT_FOUND");
    const [charge] = await db.select().from(PaymentChargeTable).where(and(
      eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.id, id), eq(PaymentChargeTable.paymentProvider, "SANDBOX"),
    ));
    if (!charge?.externalId) throw missingPaymentResource("PAYMENT_CHARGE_NOT_FOUND");
    await this.settle("SANDBOX", { eventId: "sandbox-" + charge.txid, externalId: charge.externalId,
      reference: charge.txid, amountCents: charge.amountCents, paidAt: new Date(), method: "PIX" }, undefined, companyId);
    return this.status(companyId, id);
  }

  settleAsaas(event: GatewayPaymentEvent, signature: string) {
    return this.settle("ASAAS", event, signature);
  }

  async settleMercadoPago(topic: MercadoPagoWebhookTopic, headers: WebhookSignatureContext & { signature?: string | undefined }, companyId?: string) {
    if (!companyId && topic === "payment") {
      const matches = await db.select({ companyId: PaymentChargeTable.companyId }).from(PaymentChargeTable).where(and(
        eq(PaymentChargeTable.paymentProvider, "MERCADO_PAGO"), eq(PaymentChargeTable.externalId, headers.resourceId),
      )).limit(2);
      if (matches.length === 1) companyId = matches[0]!.companyId;
    }
    const [config] = companyId ? await db.select().from(CompanyPaymentConfigTable).where(and(
      eq(CompanyPaymentConfigTable.companyId, companyId), eq(CompanyPaymentConfigTable.paymentProvider, "MERCADO_PAGO"),
    )) : [];
    const token = config?.webhookTokenEncrypted && decryptPaymentSecret(config.webhookTokenEncrypted);
    if (!config?.providerApiKeyEncrypted || !token) {
      throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    }
    const adapter = new MercadoPagoPaymentAdapter(decryptPaymentSecret(config.providerApiKeyEncrypted));
    if (!adapter.verifyWebhookSignature(headers.signature, token, headers)) {
      throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
    }
    const event = await adapter.readWebhookPayment(topic, headers.resourceId);
    return event ? this.settle("MERCADO_PAGO", event, undefined, config.companyId) : { processed: false };
  }

  private settle(provider: PaymentProvider, event: GatewayPaymentEvent, signature?: string, trustedCompanyId?: string) {
    return db.transaction(async (tx) => {
      const [initial] = await tx.select().from(PaymentChargeTable).where(and(
        eq(PaymentChargeTable.paymentProvider, provider),
        trustedCompanyId ? eq(PaymentChargeTable.companyId, trustedCompanyId) : undefined,
        or(eq(PaymentChargeTable.externalId, event.staticQrCodeId ?? event.externalId),
          event.reference ? eq(PaymentChargeTable.txid, event.reference) : undefined),
      )).limit(1);
      const subscriptionFilter = event.externalSubscriptionId ? and(
        eq(ClientSubscriptionTable.paymentProvider, provider),
        trustedCompanyId ? eq(ClientSubscriptionTable.companyId, trustedCompanyId) : undefined,
        or(eq(ClientSubscriptionTable.externalSubscriptionId, event.externalSubscriptionId),
          event.reference ? sql`${ClientSubscriptionTable.id}::text = ${event.reference}` : undefined),
      ) : undefined;
      const [recurring] = !initial && subscriptionFilter ? await tx.select().from(ClientSubscriptionTable)
        .where(subscriptionFilter).limit(1) : [];
      const companyId = initial?.companyId ?? recurring?.companyId;
      if (!companyId) {
        if (event.externalSubscriptionId && event.reference && /^[a-f0-9-]{36}$/i.test(event.reference)) {
          throw paymentConflict("SUBSCRIPTION_EVENT_NOT_READY", "O vínculo da assinatura ainda não está disponível.");
        }
        return { processed: false };
      }
      const config = await configuration(tx, companyId);
      if (provider === "ASAAS") {
        const token = config.webhookTokenEncrypted && decryptPaymentSecret(config.webhookTokenEncrypted);
        if (!token || !new AsaasPaymentAdapter("").verifyWebhookSignature(signature, token)) {
          throw new PaymentError("Assinatura de webhook inválida.", "FORBIDDEN", "PAYMENT_WEBHOOK_INVALID_SIGNATURE");
        }
      } else if (provider === "SANDBOX" && (!sandboxAllowed() || trustedCompanyId !== companyId)) {
        throw new PaymentError("Simulação indisponível.", "FORBIDDEN", "SANDBOX_DISABLED");
      }

      await lockTenant(tx, companyId);
      const [matched] = initial ? await tx.select().from(PaymentChargeTable).where(eq(PaymentChargeTable.id, initial.id)).for("update")
        : await tx.select().from(PaymentChargeTable).where(and(eq(PaymentChargeTable.companyId, companyId),
          eq(PaymentChargeTable.paymentProvider, provider), eq(PaymentChargeTable.externalId, event.externalId))).for("update");
      const [pendingCycle] = !matched && recurring && event.dueDate === recurring.nextBillingDate
        ? await tx.select().from(PaymentChargeTable).where(and(
            eq(PaymentChargeTable.companyId, companyId), eq(PaymentChargeTable.referenceType, "SUBSCRIPTION"),
            eq(PaymentChargeTable.referenceId, recurring.id), eq(PaymentChargeTable.status, "PENDING"),
            eq(PaymentChargeTable.paymentProvider, provider),
          )).for("update")
        : [];
      const saved = matched ?? pendingCycle;
      if (saved?.status === "CONFIRMED") return { processed: false };
      const [duplicate] = await tx.select({ id: PaymentWebhookEventTable.eventId }).from(PaymentWebhookEventTable).where(and(
        eq(PaymentWebhookEventTable.companyId, companyId), eq(PaymentWebhookEventTable.provider, provider), eq(PaymentWebhookEventTable.eventId, event.eventId),
      ));
      if (duplicate) return { processed: false };
      if (saved && ((saved.externalId && saved.externalId !== (event.staticQrCodeId ?? event.externalId)) ||
        (saved.method === "CREDIT_CARD") !== (event.method === "CREDIT_CARD") || saved.status === "CANCELED" ||
        (saved.expiresAt && event.paidAt > saved.expiresAt && (saved.referenceType === "APPOINTMENT_DEPOSIT" || saved.pixCopyPaste)))) {
        throw paymentConflict("PAYMENT_EVENT_MISMATCH", "A confirmação não corresponde à cobrança.");
      }
      if ((saved?.amountCents ?? recurring?.priceCents) !== event.amountCents) {
        throw paymentConflict("PAYMENT_AMOUNT_MISMATCH", "O valor recebido diverge da cobrança.");
      }
      const [charge] = saved ? await tx.update(PaymentChargeTable).set({ status: "CONFIRMED", paidAt: event.paidAt, externalId: saved.externalId ?? event.externalId })
        .where(eq(PaymentChargeTable.id, saved.id)).returning()
        : await tx.insert(PaymentChargeTable).values({
          companyId, clientId: recurring!.clientId, referenceType: "SUBSCRIPTION", referenceId: recurring!.id,
          paymentProvider: provider, txid: randomUUID(), externalId: event.externalId, amountCents: event.amountCents,
          status: "CONFIRMED", paidAt: event.paidAt, method: event.method === "PIX" ? "PIX_DYNAMIC" : "CREDIT_CARD",
        }).returning();
      const [recorded] = await tx.insert(PaymentWebhookEventTable).values({
        companyId, provider, eventId: event.eventId, chargeId: charge!.id,
      }).onConflictDoNothing().returning();
      if (!recorded) throw paymentConflict("PAYMENT_EVENT_REUSED", "O evento já foi registrado para outra cobrança.");

      if (charge!.referenceType === "ORDER") await this.closeOrder(tx, companyId, charge!.referenceId, event);
      if (charge!.referenceType === "SUBSCRIPTION") await this.activateSubscription(tx, companyId, charge!.referenceId, event);
      if (charge!.referenceType === "APPOINTMENT_DEPOSIT") await this.confirmDeposit(tx, companyId, charge!.referenceId, event.paidAt);
      return { processed: true };
    });
  }

  private async closeOrder(tx: PaymentTransaction, companyId: string, orderId: string, event: GatewayPaymentEvent) {
    const match = and(eq(FinanceOrderTable.companyId, companyId), eq(FinanceOrderTable.id, orderId));
    const [order] = await tx.select().from(FinanceOrderTable).where(match).for("update");
    if (!order || order.status !== "OPEN" || order.totalCents - order.paidCents !== event.amountCents) {
      throw paymentConflict("ORDER_BALANCE_CHANGED", "O saldo da comanda mudou após a emissão da cobrança.");
    }
    // The existing order items already carry commission amounts and the financial projections release them after payment.
    await tx.insert(FinanceOrderPaymentTable).values({
      companyId, orderId, method: event.method, amountCents: event.amountCents, paidAt: event.paidAt,
    });
    await tx.update(FinanceOrderTable).set({ status: "CLOSED", paidCents: order.totalCents, updatedAt: event.paidAt }).where(match);
  }

  private async activateSubscription(tx: PaymentTransaction, companyId: string, id: string, event: GatewayPaymentEvent) {
    const match = and(eq(ClientSubscriptionTable.companyId, companyId), eq(ClientSubscriptionTable.id, id));
    const [subscription] = await tx.select().from(ClientSubscriptionTable).where(match).for("update");
    if (!subscription || subscription.status === "CANCELED" ||
      (subscription.paymentProvider !== "MERCADO_PAGO" && subscription.paymentMethod !== event.method) ||
      (event.externalSubscriptionId && subscription.externalSubscriptionId !== event.externalSubscriptionId)) {
      throw paymentConflict("SUBSCRIPTION_EVENT_MISMATCH", "A confirmação não corresponde à assinatura.");
    }
    const due = event.dueDate ?? subscription.nextBillingDate;
    if (due < subscription.nextBillingDate) return;
    const company = await tenant(tx, companyId);
    const next = nextMonthlyDate(due);
    const currentPeriodStart = localMidnight(due, company.timezone);
    const currentPeriodEnd = localMidnight(next, company.timezone);
    await tx.update(ClientSubscriptionTable).set({
      status: "ACTIVE", currentPeriodStart, currentPeriodEnd, nextBillingDate: next, paymentMethod: event.method,
    }).where(match);
    await refreshOverdue(tx, company.id, new Date());
  }

  private async confirmDeposit(tx: PaymentTransaction, companyId: string, id: string, paidAt: Date) {
    const [appointment] = await tx.update(AppointmentTable).set({ status: "CONFIRMED", updatedAt: paidAt }).where(and(
      eq(AppointmentTable.companyId, companyId), eq(AppointmentTable.id, id),
      eq(AppointmentTable.status, "PENDING"), sql`${AppointmentTable.startsAt} > now()`,
    )).returning({ id: AppointmentTable.id });
    if (!appointment) throw paymentConflict("DEPOSIT_APPOINTMENT_CHANGED", "A pré-reserva não está mais disponível.");
  }
}
