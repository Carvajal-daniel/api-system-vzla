import { createHash, randomBytes } from "node:crypto";
import { Phone } from "../../../shared/value-objects/phone.value-object.js";
import type { AppointmentOutputDTO } from "../../appointments/application/dtos/appointment.dtos.js";
import type { GetAvailabilityOutputDTO } from "../../appointments/application/dtos/availability.dtos.js";
import type { CreateAppointmentUseCase } from "../../appointments/application/use-cases/create-appointment.use-case.js";
import type { GetAvailabilityUseCase } from "../../appointments/application/use-cases/get-availability.use-case.js";
import { getLocalDateTimeParts } from "../../appointments/domain/services/timezone-utils.js";
import type { WaitlistShift } from "../../operations/infra/database/schema/operations-schema.js";
import type { WaitlistEntryRecord, WaitlistUseCase } from "../../operations/application/waitlist.use-case.js";
import type { PublicCatalogServiceOutputDTO } from "../../services/application/dtos/service.dtos.js";
import type { ListPublicCompanyCatalogUseCase } from "../../services/application/use-cases/list-public-company-catalog.use-case.js";
import {
  PublicPortalCompanyNotFoundError,
  PublicPortalPaymentProviderUnavailableError,
} from "../domain/public-portal.errors.js";
import type {
  PublicActiveSubscriptionCoverage,
  PublicClubPlanDTO,
  PublicDepositPolicyDTO,
  PublicPaymentChargeDTO,
  PublicPaymentStatusDTO,
  PublicPortalPaymentsPort,
  PublicPortalReadPort,
} from "./ports/public-portal.port.js";

export interface PublicStorefrontOutputDTO {
  company: {
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
  };
  depositPolicy: PublicDepositPolicyDTO;
  services: PublicCatalogServiceOutputDTO[];
  clubPlans: PublicClubPlanDTO[];
}

export interface IdentifyCustomerOutputDTO {
  recognized: boolean;
  isSubscriber: boolean;
  subscription: {
    planId: string;
    planName: string;
    status: "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELED";
    includedServiceIds: string[];
    allowedDaysOfWeek: number[] | null;
    maxMonthlyUses: number | null;
    remainingUses: number | null;
    exemptsServicePrice: boolean;
    exemptsDeposit: boolean;
  } | null;
}

export interface CreatePublicPortalAppointmentOutputDTO {
  appointment: AppointmentOutputDTO;
  cancellationToken: string;
  coveredByClub: boolean;
  requiresDeposit: boolean;
  payment: PublicPaymentChargeDTO | null;
}

export interface PublicClubSubscribeOutputDTO {
  subscriptionId: string;
  planId: string;
  status: string;
  payment: PublicPaymentChargeDTO;
}

export interface PublicWaitlistOutputDTO {
  id: string;
  desiredDate: string;
  preferredShift: WaitlistShift;
  collaboratorId: string | null;
  collaboratorName: string | null;
  status: WaitlistEntryRecord["status"];
  createdAt: string;
}

function isSubscriptionUsableAt(
  coverage: PublicActiveSubscriptionCoverage | null,
  serviceId: string,
  startsAt: Date,
  timezone: string,
  now: Date,
): boolean {
  if (!coverage) return false;
  if (!coverage.includedServiceIds.includes(serviceId)) return false;

  const graceEnd = coverage.currentPeriodEnd
    ? new Date(coverage.currentPeriodEnd.getTime() + coverage.gracePeriodDays * 86_400_000)
    : null;

  const isStatusEligible =
    coverage.status === "ACTIVE" ||
    ((coverage.status === "PAST_DUE" || coverage.status === "SUSPENDED") &&
      graceEnd !== null &&
      now.getTime() < graceEnd.getTime());

  if (!isStatusEligible) return false;

  if (coverage.currentPeriodStart && startsAt < coverage.currentPeriodStart) {
    return false;
  }
  if (graceEnd && startsAt >= graceEnd) {
    return false;
  }

  if (coverage.maxMonthlyUses !== null && coverage.usedThisPeriod >= coverage.maxMonthlyUses) {
    return false;
  }

  if (coverage.allowedDaysOfWeek !== null) {
    const localDay = getLocalDateTimeParts(startsAt, timezone).dayOfWeek;
    if (!coverage.allowedDaysOfWeek.includes(localDay)) {
      return false;
    }
  }

  return true;
}

function isSubscriptionActiveNow(
  coverage: PublicActiveSubscriptionCoverage | null,
  now: Date,
): boolean {
  if (!coverage) return false;
  if (coverage.status === "ACTIVE") return true;
  if (
    (coverage.status === "PAST_DUE" || coverage.status === "SUSPENDED") &&
    coverage.currentPeriodEnd
  ) {
    const graceEnd =
      coverage.currentPeriodEnd.getTime() + coverage.gracePeriodDays * 86_400_000;
    return now.getTime() < graceEnd;
  }
  return false;
}

// Orquestra os fluxos públicos do portal por slug reutilizando os casos de uso existentes
// sem duplicar regras de domínio e garantindo isolamento estrito por companyId.
export class PublicPortalService {
  constructor(
    private readonly readPort: PublicPortalReadPort,
    private readonly paymentsPort: PublicPortalPaymentsPort,
    private readonly catalogUseCase: ListPublicCompanyCatalogUseCase,
    private readonly availabilityUseCase: GetAvailabilityUseCase,
    private readonly createAppointmentUseCase: CreateAppointmentUseCase,
    private readonly waitlistUseCase: WaitlistUseCase,
  ) {}

  private async resolveCompany(slug: string) {
    const normalizedSlug = slug.trim().toLowerCase();
    const company = await this.readPort.findActiveCompanyBySlug(normalizedSlug);
    if (!company) {
      throw new PublicPortalCompanyNotFoundError();
    }
    return company;
  }

  async getStorefront(slug: string): Promise<PublicStorefrontOutputDTO> {
    const company = await this.resolveCompany(slug);
    const [catalog, clubPlans] = await Promise.all([
      this.catalogUseCase.execute(company.id),
      this.readPort.listActiveClubPlans(company.id),
    ]);

    return {
      company: {
        id: company.id,
        companyName: company.companyName,
        slug: company.slug,
        phone: company.phone,
        whatsapp: company.whatsapp,
        timezone: company.timezone,
        currency: company.currency,
        avatarUrl: company.avatarUrl,
        description: company.description,
        address: company.address,
        appearance: company.appearance,
        operatingDays: company.operatingDays,
        operatingSchedule: company.operatingSchedule,
      },
      depositPolicy: company.depositPolicy,
      services: catalog.services,
      clubPlans,
    };
  }

  async getAvailability(
    slug: string,
    query: {
      serviceId: string;
      date: string;
      collaboratorId?: string | undefined;
    },
    now?: Date,
  ): Promise<GetAvailabilityOutputDTO> {
    const company = await this.resolveCompany(slug);
    return this.availabilityUseCase.execute({
      companyId: company.id,
      actorSource: "PUBLIC",
      serviceId: query.serviceId,
      date: query.date,
      collaboratorId: query.collaboratorId,
      now,
    });
  }

  async identifyCustomer(
    slug: string,
    input: { phone: string; name?: string | undefined },
    now: Date = new Date(),
  ): Promise<IdentifyCustomerOutputDTO> {
    const company = await this.resolveCompany(slug);
    const normalizedPhone = Phone.create(input.phone).value;

    const [client, coverage] = await Promise.all([
      this.readPort.findClientByPhone(company.id, normalizedPhone),
      this.readPort.findActiveClubCoverageByPhone(company.id, normalizedPhone, now),
    ]);

    const active = isSubscriptionActiveNow(coverage, now);
    if (!active || !coverage) {
      return {
        recognized: Boolean(client),
        isSubscriber: false,
        subscription: null,
      };
    }

    const remainingUses =
      coverage.maxMonthlyUses !== null
        ? Math.max(0, coverage.maxMonthlyUses - coverage.usedThisPeriod)
        : null;
    const hasRemainingQuota = remainingUses === null || remainingUses > 0;

    return {
      recognized: Boolean(client) || active,
      isSubscriber: true,
      subscription: {
        planId: coverage.planId,
        planName: coverage.planName,
        status: coverage.status,
        includedServiceIds: coverage.includedServiceIds,
        allowedDaysOfWeek: coverage.allowedDaysOfWeek,
        maxMonthlyUses: coverage.maxMonthlyUses,
        remainingUses,
        exemptsServicePrice: hasRemainingQuota,
        exemptsDeposit: hasRemainingQuota,
      },
    };
  }

  async createAppointment(
    slug: string,
    input: {
      serviceId: string;
      collaboratorId: string;
      startsAt: Date;
      clientName: string;
      clientPhone: string;
      clientData?: Record<string, string> | undefined;
      document?: string | undefined;
    },
    now: Date = new Date(),
  ): Promise<CreatePublicPortalAppointmentOutputDTO> {
    const company = await this.resolveCompany(slug);
    const normalizedPhone = Phone.create(input.clientPhone).value;
    const trimmedName = input.clientName.trim();

    const [client, coverage, service] = await Promise.all([
      this.readPort.upsertClientByPhone(company.id, {
        name: trimmedName,
        phone: normalizedPhone,
      }),
      this.readPort.findActiveClubCoverageByPhone(company.id, normalizedPhone, now),
      this.readPort.findServicePrice(company.id, input.serviceId),
    ]);

    const coveredByClub = isSubscriptionUsableAt(
      coverage,
      input.serviceId,
      input.startsAt,
      company.timezone,
      now,
    );

    const depositPolicy = company.depositPolicy;
    const depositRequiredByPolicy =
      !coveredByClub && depositPolicy.enabled && depositPolicy.depositPercentage > 0;

    // Comportamento fail-closed: se o estabelecimento exige sinal mas não há provedor online ativo,
    // rejeita antes de criar o agendamento para não furar a política anti-no-show.
    if (depositRequiredByPolicy && !depositPolicy.hasActivePaymentProvider) {
      throw new PublicPortalPaymentProviderUnavailableError();
    }

    const depositAmountCents =
      depositRequiredByPolicy && service?.active
        ? Math.round((service.priceInCents * depositPolicy.depositPercentage) / 100)
        : 0;

    const shouldChargeDeposit = depositRequiredByPolicy && depositAmountCents > 0;
    const cancellationToken = randomBytes(32).toString("base64url");
    const cancellationDigest = createHash("sha256")
      .update(cancellationToken)
      .digest("hex");

    const appointment = await this.createAppointmentUseCase.executePublic({
      companyId: company.id,
      serviceId: input.serviceId,
      collaboratorId: input.collaboratorId,
      startsAt: input.startsAt,
      clientName: trimmedName,
      clientPhone: normalizedPhone,
      initialStatus: shouldChargeDeposit ? "PENDING" : "CONFIRMED",
      payFullPrice: !coveredByClub,
      publicDetails: {
        clientData: input.clientData ?? {},
        cancellationDigest,
      },
      now,
    });

    if (!shouldChargeDeposit) {
      return {
        appointment,
        cancellationToken,
        coveredByClub: appointment.usesClubBenefit,
        requiresDeposit: false,
        payment: null,
      };
    }

    try {
      const payment = await this.paymentsPort.createDepositPix({
        companyId: company.id,
        appointmentId: appointment.id,
        clientId: client.id,
        amountCents: depositAmountCents,
        document: input.document,
      });

      return {
        appointment,
        cancellationToken,
        coveredByClub: false,
        requiresDeposit: true,
        payment,
      };
    } catch (error) {
      // Libera o slot imediatamente caso a geração do Pix falhe após a pré-reserva PENDING.
      await this.readPort.cancelPendingAppointmentBestEffort(
        company.id,
        appointment.id,
        "Falha ao gerar cobrança Pix do sinal no portal público.",
      );
      throw error;
    }
  }

  async subscribeClub(
    slug: string,
    input: {
      customerName: string;
      customerPhone: string;
      planId: string;
      document?: string | undefined;
      remoteIp?: string | undefined;
    },
  ): Promise<PublicClubSubscribeOutputDTO> {
    const company = await this.resolveCompany(slug);
    if (!company.depositPolicy.hasActivePaymentProvider) {
      throw new PublicPortalPaymentProviderUnavailableError();
    }

    const normalizedPhone = Phone.create(input.customerPhone).value;
    const client = await this.readPort.upsertClientByPhone(company.id, {
      name: input.customerName.trim(),
      phone: normalizedPhone,
    });

    return this.paymentsPort.enrollClubPix({
      companyId: company.id,
      clientId: client.id,
      planId: input.planId,
      document: input.document,
      remoteIp: input.remoteIp,
    });
  }

  async joinWaitlist(
    slug: string,
    input: {
      customerName: string;
      customerPhone: string;
      desiredDate: string;
      collaboratorId?: string | null | undefined;
      preferredShift?: WaitlistShift | undefined;
    },
  ): Promise<PublicWaitlistOutputDTO> {
    const company = await this.resolveCompany(slug);
    const normalizedPhone = Phone.create(input.customerPhone).value;
    const client = await this.readPort.upsertClientByPhone(company.id, {
      name: input.customerName.trim(),
      phone: normalizedPhone,
    });

    const entry = await this.waitlistUseCase.addPublicEntry({
      companyId: company.id,
      clientId: client.id,
      collaboratorId: input.collaboratorId ?? null,
      desiredDate: input.desiredDate,
      preferredShift: input.preferredShift ?? "ANY",
    });

    return {
      id: entry.id,
      desiredDate: entry.desiredDate,
      preferredShift: entry.preferredShift,
      collaboratorId: entry.collaboratorId,
      collaboratorName: entry.collaboratorName,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  async getPaymentStatus(
    slug: string,
    paymentId: string,
  ): Promise<PublicPaymentStatusDTO> {
    const company = await this.resolveCompany(slug);
    return this.paymentsPort.getPaymentStatus(company.id, paymentId);
  }
}
