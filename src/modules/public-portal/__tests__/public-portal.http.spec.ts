import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app as productionApp } from "../../../shared/http/App.js";
import { registerErrorHandler } from "../../../shared/http/error-handler.js";
import { InMemoryAppointmentsRepository } from "../../appointments/application/__tests__/in-memory-appointments.repository.js";
import { InMemoryScheduleBlocksRepository } from "../../appointments/application/__tests__/in-memory-schedule-blocks.repository.js";
import { InMemorySchedulingContextLookupRepository } from "../../appointments/application/__tests__/in-memory-scheduling-context-lookup.repository.js";
import { CreateAppointmentUseCase } from "../../appointments/application/use-cases/create-appointment.use-case.js";
import { GetAvailabilityUseCase } from "../../appointments/application/use-cases/get-availability.use-case.js";
import { Appointment } from "../../appointments/domain/entities/appointment.entity.js";
import type {
  AppointmentsRepository,
  BookingPolicyOptions,
  PublicBookingDetails,
} from "../../appointments/domain/repositories/appointments.repository.js";
import { localDateTimeToUtc } from "../../appointments/domain/services/timezone-utils.js";
import type { OperationsNotificationPort } from "../../operations/application/ports/operations-notification.port.js";
import {
  WaitlistUseCase,
  type WaitlistEntryRecord,
  type WaitlistRepositoryPort,
} from "../../operations/application/waitlist.use-case.js";
import { missingPaymentResource } from "../../payments/domain/payment-policy.js";
import { InMemoryCollaboratorLookupRepository } from "../../services/application/__tests__/in-memory-collaborator-lookup.repository.js";
import { InMemoryCollaboratorServicesRepository } from "../../services/application/__tests__/in-memory-collaborator-services.repository.js";
import { InMemoryCompanyLookupRepository } from "../../services/application/__tests__/in-memory-company-lookup.repository.js";
import { InMemoryServicesRepository } from "../../services/application/__tests__/in-memory-services.repository.js";
import { ListPublicCompanyCatalogUseCase } from "../../services/application/use-cases/list-public-company-catalog.use-case.js";
import { CollaboratorServiceEntity } from "../../services/domain/entities/collaborator-service.entity.js";
import { ServiceEntity } from "../../services/domain/entities/service.entity.js";
import type {
  PublicActiveSubscriptionCoverage,
  PublicClubPlanDTO,
  PublicCompanyProfile,
  PublicCustomerRecord,
  PublicPaymentChargeDTO,
  PublicPaymentStatusDTO,
  PublicPortalPaymentsPort,
  PublicPortalReadPort,
} from "../application/ports/public-portal.port.js";
import {
  isValidCompanySlug,
  normalizeCustomCompanySlug,
  slugifyCompanyName,
} from "../../Company/domain/slug.js";
import { publicPortalRoutes } from "../infra/http/routes/public-portal.routes.js";

class ClubAwareInMemoryAppointmentsRepository implements AppointmentsRepository {
  private readonly inner = new InMemoryAppointmentsRepository();
  get items() {
    return this.inner.items;
  }

  async createWithLock(
    appointment: Appointment,
    _details?: PublicBookingDetails,
    policy?: BookingPolicyOptions,
  ): Promise<Appointment> {
    const usesClubBenefit = policy?.payFullPrice === false;
    const persisted = usesClubBenefit
      ? Appointment.restore({
          id: appointment.id,
          companyId: appointment.companyId,
          collaboratorId: appointment.collaboratorId,
          serviceId: appointment.serviceId,
          clientName: appointment.clientName,
          clientPhone: appointment.clientPhone,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          status: appointment.status,
          cancellationReason: appointment.cancellationReason,
          notes: appointment.notes,
          isGuest: false,
          usesClubBenefit: true,
          serviceNameSnapshot: appointment.serviceNameSnapshot,
          servicePriceInCentsSnapshot: 0,
          serviceDurationMinutesSnapshot: appointment.serviceDurationMinutesSnapshot,
          commissionPercentageSnapshot: appointment.commissionPercentageSnapshot,
          createdAt: appointment.createdAt,
          updatedAt: appointment.updatedAt,
        })
      : appointment;

    await this.inner.createWithLock(persisted);
    return persisted;
  }

  rescheduleWithLock = (appointment: Appointment) => this.inner.rescheduleWithLock(appointment);
  save = (appointment: Appointment) => this.inner.save(appointment);
  revertCompletionWithAudit = this.inner.revertCompletionWithAudit.bind(this.inner);
  listAuditLogs = this.inner.listAuditLogs.bind(this.inner);
  findById = this.inner.findById.bind(this.inner);
  list = this.inner.list.bind(this.inner);
  findActiveOverlapping = this.inner.findActiveOverlapping.bind(this.inner);
}

class InMemoryPublicPortalReadPort implements PublicPortalReadPort {
  public companies = new Map<string, PublicCompanyProfile>();
  public clubPlans = new Map<string, PublicClubPlanDTO[]>();
  public clients = new Map<string, PublicCustomerRecord>();
  public subscriptions = new Map<string, PublicActiveSubscriptionCoverage>();
  public servicePrices = new Map<string, { id: string; priceInCents: number; active: boolean }>();
  public canceledAppointments: string[] = [];

  async findActiveCompanyBySlug(slug: string): Promise<PublicCompanyProfile | null> {
    return this.companies.get(slug) ?? null;
  }

  async listActiveClubPlans(companyId: string): Promise<PublicClubPlanDTO[]> {
    return this.clubPlans.get(companyId) ?? [];
  }

  async findClientByPhone(
    companyId: string,
    normalizedPhone: string,
  ): Promise<PublicCustomerRecord | null> {
    return this.clients.get(`${companyId}:${normalizedPhone}`) ?? null;
  }

  async upsertClientByPhone(
    companyId: string,
    input: { name: string; phone: string },
  ): Promise<PublicCustomerRecord> {
    const key = `${companyId}:${input.phone}`;
    const existing = this.clients.get(key);
    if (existing) return existing;
    const created: PublicCustomerRecord = {
      id: randomUUID(),
      name: input.name,
      phone: input.phone,
    };
    this.clients.set(key, created);
    return created;
  }

  async findActiveClubCoverageByPhone(
    companyId: string,
    normalizedPhone: string,
    _now: Date,
  ): Promise<PublicActiveSubscriptionCoverage | null> {
    return this.subscriptions.get(`${companyId}:${normalizedPhone}`) ?? null;
  }

  async findServicePrice(
    companyId: string,
    serviceId: string,
  ): Promise<{ id: string; priceInCents: number; active: boolean } | null> {
    return this.servicePrices.get(`${companyId}:${serviceId}`) ?? null;
  }

  async cancelPendingAppointmentBestEffort(
    _companyId: string,
    appointmentId: string,
    _reason: string,
  ): Promise<void> {
    this.canceledAppointments.push(appointmentId);
  }
}

class InMemoryPublicPortalPaymentsPort implements PublicPortalPaymentsPort {
  public charges = new Map<
    string,
    { companyId: string; status: PublicPaymentStatusDTO }
  >();

  async createDepositPix(input: {
    companyId: string;
    appointmentId: string;
    clientId: string;
    amountCents: number;
    document?: string | undefined;
  }): Promise<PublicPaymentChargeDTO> {
    const paymentId = randomUUID();
    const expiresAt = new Date("2030-05-14T12:15:00.000Z").toISOString();
    this.charges.set(paymentId, {
      companyId: input.companyId,
      status: { paymentId, status: "PENDING", expiresAt, paidAt: null },
    });

    return {
      paymentId,
      amountCents: input.amountCents,
      status: "PENDING",
      qrCodeBase64: "data:image/png;base64,FAKE_DEPOSIT_QR",
      copyPaste: `000201PIXDEPOSIT${paymentId.slice(0, 8)}`,
      checkoutUrl: null,
      expiresAt,
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
    const subscriptionId = randomUUID();
    const paymentId = randomUUID();
    const expiresAt = new Date("2030-05-15T12:00:00.000Z").toISOString();
    this.charges.set(paymentId, {
      companyId: input.companyId,
      status: { paymentId, status: "PENDING", expiresAt, paidAt: null },
    });

    return {
      subscriptionId,
      planId: input.planId,
      status: "PENDING_PAYMENT",
      payment: {
        paymentId,
        amountCents: 9900,
        status: "PENDING",
        qrCodeBase64: "data:image/png;base64,FAKE_CLUB_QR",
        copyPaste: `000201PIXCLUB${paymentId.slice(0, 8)}`,
        checkoutUrl: null,
        expiresAt,
      },
    };
  }

  async getPaymentStatus(
    companyId: string,
    paymentId: string,
  ): Promise<PublicPaymentStatusDTO> {
    const found = this.charges.get(paymentId);
    if (!found || found.companyId !== companyId) {
      throw missingPaymentResource("PAYMENT_CHARGE_NOT_FOUND");
    }
    return found.status;
  }
}

class InMemoryWaitlistRepo implements WaitlistRepositoryPort {
  public entries: WaitlistEntryRecord[] = [];
  constructor(
    private readonly readPort: InMemoryPublicPortalReadPort,
    private readonly collaborators: Map<string, { id: string; name: string }>,
  ) {}

  async getCompanyContext(_companyId: string) {
    return { companyName: "Barbearia Corte Fino", timezone: "America/Sao_Paulo" };
  }

  async clientExistsInCompany(companyId: string, clientId: string): Promise<boolean> {
    return [...this.readPort.clients.entries()].some(
      ([key, client]) => key.startsWith(`${companyId}:`) && client.id === clientId,
    );
  }

  async collaboratorExistsInCompany(companyId: string, collaboratorId: string) {
    return this.collaborators.get(`${companyId}:${collaboratorId}`) ?? null;
  }

  async createEntry(params: {
    companyId: string;
    clientId: string;
    collaboratorId: string | null;
    desiredDate: string;
    preferredShift: "MORNING" | "AFTERNOON" | "EVENING" | "ANY";
  }): Promise<WaitlistEntryRecord> {
    const client = [...this.readPort.clients.values()].find(
      (c) => c.id === params.clientId,
    )!;
    const collab = params.collaboratorId
      ? this.collaborators.get(`${params.companyId}:${params.collaboratorId}`) ?? null
      : null;

    const record: WaitlistEntryRecord = {
      id: randomUUID(),
      companyId: params.companyId,
      clientId: params.clientId,
      clientName: client.name,
      clientPhone: client.phone,
      collaboratorId: params.collaboratorId,
      collaboratorName: collab?.name ?? null,
      desiredDate: params.desiredDate,
      preferredShift: params.preferredShift,
      status: "WAITING",
      notifiedAt: null,
      expiresAt: null,
      createdAt: new Date("2030-05-14T12:00:00.000Z"),
    };
    this.entries.push(record);
    return record;
  }

  async listEntries() {
    return this.entries;
  }
  async findWaitingCandidatesForDate() {
    return [];
  }
  async markEntryNotified() {
    return null;
  }
  async expireStaleNotifiedEntries() {
    return [];
  }
}

const noopOperationsNotification: OperationsNotificationPort = {
  async sendOperationalMessage() {
    return { delivered: true, provider: "TEST", externalMessageId: null };
  },
};

describe("Public Booking Portal (/public/:slug/*)", () => {
  const companyId = "11111111-1111-4111-8111-111111111111";
  const otherCompanyId = "22222222-2222-4222-8222-222222222222";
  const collaboratorId = "33333333-3333-4333-8333-333333333333";
  const serviceCutId = "44444444-4444-4444-8444-444444444444";
  const serviceBeardId = "55555555-5555-4555-8555-555555555555";
  const clubPlanId = "66666666-6666-4666-8666-666666666666";

  const fixedNow = new Date("2030-05-14T12:00:00.000Z");
  const bookingDate = "2030-05-15"; // Quarta-feira (dayOfWeek = 3)
  const slot10hUtc = localDateTimeToUtc(2030, 5, 15, 10, 0, "America/Sao_Paulo");

  let app: FastifyInstance;
  let readPort: InMemoryPublicPortalReadPort;
  let paymentsPort: InMemoryPublicPortalPaymentsPort;
  let appointmentsRepo: ClubAwareInMemoryAppointmentsRepository;

  beforeAll(async () => {
    await productionApp.ready();
  });

  beforeEach(async () => {
    readPort = new InMemoryPublicPortalReadPort();
    paymentsPort = new InMemoryPublicPortalPaymentsPort();
    appointmentsRepo = new ClubAwareInMemoryAppointmentsRepository();
    const blocksRepo = new InMemoryScheduleBlocksRepository();
    const schedulingLookup = new InMemorySchedulingContextLookupRepository();

    const servicesRepo = new InMemoryServicesRepository();
    const collabServicesRepo = new InMemoryCollaboratorServicesRepository();
    const collabLookup = new InMemoryCollaboratorLookupRepository();
    const companyLookup = new InMemoryCompanyLookupRepository();

    readPort.companies.set("barbearia-corte-fino", {
      id: companyId,
      companyName: "Barbearia Corte Fino",
      slug: "barbearia-corte-fino",
      phone: "+5511999990000",
      whatsapp: "+5511999990000",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      avatarUrl: "https://cdn.example.com/logo.png",
      description: "Cortes clássicos e barba na navalha.",
      address: { street: "Rua Augusta", number: "100", city: "São Paulo", state: "SP" },
      appearance: { mode: "dark", locale: "pt-BR", palette: "gold" },
      operatingDays: "1,2,3,4,5,6",
      operatingSchedule: [{ dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" }],
      paymentProvider: "SANDBOX",
      depositPolicy: {
        enabled: true,
        depositPercentage: 30,
        autoRefundHours: 24,
        noShowPolicy: "Sinal de 30% descontado no atendimento.",
        hasActivePaymentProvider: true,
      },
    });

    readPort.companies.set("salao-sem-gateway", {
      id: otherCompanyId,
      companyName: "Salão Sem Gateway",
      slug: "salao-sem-gateway",
      phone: "+5511988887777",
      whatsapp: "+5511988887777",
      timezone: "America/Sao_Paulo",
      currency: "BRL",
      avatarUrl: null,
      description: null,
      address: null,
      appearance: null,
      operatingDays: "1,2,3,4,5",
      operatingSchedule: null,
      paymentProvider: "NONE",
      depositPolicy: {
        enabled: true,
        depositPercentage: 50,
        autoRefundHours: 12,
        noShowPolicy: "Sinal obrigatório.",
        hasActivePaymentProvider: false,
      },
    });

    readPort.clubPlans.set(companyId, [
      {
        id: clubPlanId,
        name: "Clube Corte Ilimitado",
        description: "Cortes ilimitados de segunda a sexta.",
        priceCents: 9900,
        billingCycle: "MONTHLY",
        includedServiceIds: [serviceCutId],
        maxMonthlyUses: 4,
        allowedDaysOfWeek: [1, 2, 3, 4, 5],
        gracePeriodDays: 3,
      },
    ]);

    readPort.servicePrices.set(`${companyId}:${serviceCutId}`, {
      id: serviceCutId,
      priceInCents: 5000,
      active: true,
    });
    readPort.servicePrices.set(`${companyId}:${serviceBeardId}`, {
      id: serviceBeardId,
      priceInCents: 4000,
      active: true,
    });

    // Cliente assinante ativo do Clube
    const subscriberPhone = "+5511912345678";
    readPort.clients.set(`${companyId}:${subscriberPhone}`, {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Carlos Assinante",
      phone: subscriberPhone,
    });
    readPort.subscriptions.set(`${companyId}:${subscriberPhone}`, {
      subscriptionId: "88888888-8888-4888-8888-888888888888",
      planId: clubPlanId,
      planName: "Clube Corte Ilimitado",
      status: "ACTIVE",
      includedServiceIds: [serviceCutId],
      allowedDaysOfWeek: [1, 2, 3, 4, 5],
      maxMonthlyUses: 4,
      usedThisPeriod: 1,
      currentPeriodStart: new Date("2030-05-01T03:00:00.000Z"),
      currentPeriodEnd: new Date("2030-06-01T03:00:00.000Z"),
      gracePeriodDays: 3,
    });

    // Catálogo e agendamento em memória
    companyLookup.seed({
      id: companyId,
      companyName: "Barbearia Corte Fino",
      timezone: "America/Sao_Paulo",
      isActive: true,
    });
    collabLookup.items.push({
      id: collaboratorId,
      companyId,
      name: "Lucas Barbeiro",
      specialty: "Degradê",
      isActive: true,
    });
    await servicesRepo.create(
      ServiceEntity.restore({
        id: serviceCutId,
        companyId,
        name: "Corte Degradê",
        description: "Acabamento na navalha",
        durationMinutes: 30,
        priceInCents: 5000,
        active: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    await servicesRepo.create(
      ServiceEntity.restore({
        id: serviceBeardId,
        companyId,
        name: "Barba Completa",
        description: "Toalha quente",
        durationMinutes: 30,
        priceInCents: 4000,
        active: true,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    await collabServicesRepo.create(
      CollaboratorServiceEntity.create({
        companyId,
        collaboratorId,
        serviceId: serviceCutId,
        commissionPercentage: 50,
      }),
    );
    await collabServicesRepo.create(
      CollaboratorServiceEntity.create({
        companyId,
        collaboratorId,
        serviceId: serviceBeardId,
        commissionPercentage: 50,
      }),
    );

    schedulingLookup.addCompany({
      id: companyId,
      companyName: "Barbearia Corte Fino",
      timezone: "America/Sao_Paulo",
      isActive: true,
    });
    schedulingLookup.addService({
      id: serviceCutId,
      companyId,
      name: "Corte Degradê",
      durationMinutes: 30,
      priceInCents: 5000,
      active: true,
    });
    schedulingLookup.addService({
      id: serviceBeardId,
      companyId,
      name: "Barba Completa",
      durationMinutes: 30,
      priceInCents: 4000,
      active: true,
    });
    schedulingLookup.addCollaborator({
      id: collaboratorId,
      companyId,
      name: "Lucas Barbeiro",
      isActive: true,
    });
    schedulingLookup.linkCollaboratorToService(companyId, serviceCutId, collaboratorId, 50);
    schedulingLookup.linkCollaboratorToService(companyId, serviceBeardId, collaboratorId, 50);
    schedulingLookup.setWorkSchedule(companyId, collaboratorId, {
      dayOfWeek: 3,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "12:00",
      breakStart: null,
      breakEnd: null,
    });

    const waitlistRepo = new InMemoryWaitlistRepo(
      readPort,
      new Map([[`${companyId}:${collaboratorId}`, { id: collaboratorId, name: "Lucas Barbeiro" }]]),
    );

    app = fastify();
    registerErrorHandler(app);
    await app.register(publicPortalRoutes, {
      readPort,
      paymentsPort,
      catalogUseCase: new ListPublicCompanyCatalogUseCase(
        servicesRepo,
        collabServicesRepo,
        collabLookup,
        companyLookup,
      ),
      availabilityUseCase: new GetAvailabilityUseCase(
        schedulingLookup,
        blocksRepo,
        appointmentsRepo,
      ),
      createAppointmentUseCase: new CreateAppointmentUseCase(
        schedulingLookup,
        blocksRepo,
        appointmentsRepo,
      ),
      waitlistUseCase: new WaitlistUseCase(waitlistRepo, noopOperationsNotification),
      now: () => fixedNow,
    });
    await app.ready();
  });

  afterAll(async () => {
    await productionApp.close();
  });

  it("returns 404 when slug does not exist or company is inactive", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/public/barbearia-inexistente",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      code: "PUBLIC_PORTAL_COMPANY_NOT_FOUND",
    });
  });

  it("GET /public/:slug returns storefront data, deposit policy with provider flag, services, barbers, and active club plans", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/public/barbearia-corte-fino",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company.slug).toBe("barbearia-corte-fino");
    expect(body.depositPolicy).toEqual({
      enabled: true,
      depositPercentage: 30,
      autoRefundHours: 24,
      noShowPolicy: "Sinal de 30% descontado no atendimento.",
      hasActivePaymentProvider: true,
    });
    expect(body.services).toHaveLength(2);
    expect(body.services[0].collaborators[0].name).toBe("Lucas Barbeiro");
    expect(body.clubPlans).toHaveLength(1);
    expect(body.clubPlans[0].name).toBe("Clube Corte Ilimitado");
  });

  it("GET /public/:slug/availability returns real open slots", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/public/barbearia-corte-fino/availability?serviceId=${serviceCutId}&date=${bookingDate}&collaboratorId=${collaboratorId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.companyId).toBe(companyId);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0].collaboratorId).toBe(collaboratorId);
  });

  it("POST /public/:slug/identify recognizes active Club subscriber without leaking sensitive data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/identify",
      payload: { phone: "(11) 91234-5678", name: "Carlos" },
    });

    // Normalização com +55 deve casar com +5511912345678 quando enviado com +55
    const resE164 = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/identify",
      payload: { phone: "+55 (11) 91234-5678" },
    });

    expect(res.statusCode).toBe(200);
    expect(resE164.statusCode).toBe(200);
    const body = resE164.json();
    expect(body).toEqual({
      recognized: true,
      isSubscriber: true,
      subscription: {
        planId: clubPlanId,
        planName: "Clube Corte Ilimitado",
        status: "ACTIVE",
        includedServiceIds: [serviceCutId],
        allowedDaysOfWeek: [1, 2, 3, 4, 5],
        maxMonthlyUses: 4,
        remainingUses: 3,
        exemptsServicePrice: true,
        exemptsDeposit: true,
      },
    });
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("notes");
  });

  it("POST /public/:slug/appointments confirms immediately with zeroed price and no deposit for covered Club subscriber", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/appointments",
      payload: {
        serviceId: serviceCutId,
        collaboratorId,
        startsAt: slot10hUtc.toISOString(),
        clientName: "Carlos Assinante",
        clientPhone: "+5511912345678",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.coveredByClub).toBe(true);
    expect(body.requiresDeposit).toBe(false);
    expect(body.payment).toBeNull();
    expect(body.appointment.status).toBe("CONFIRMED");
    expect(body.appointment.usesClubBenefit).toBe(true);
    expect(body.appointment.servicePriceInCentsSnapshot).toBe(0);
    expect(body.cancellationToken).toBeTruthy();
  });

  it("POST /public/:slug/appointments creates PENDING appointment and generates Pix deposit for non-subscriber", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/appointments",
      payload: {
        serviceId: serviceCutId,
        collaboratorId,
        startsAt: slot10hUtc.toISOString(),
        clientName: "João Visitante",
        clientPhone: "+5511977776666",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.coveredByClub).toBe(false);
    expect(body.requiresDeposit).toBe(true);
    expect(body.appointment.status).toBe("PENDING");
    expect(body.appointment.servicePriceInCentsSnapshot).toBe(5000);
    // 30% de R$ 50,00 = R$ 15,00 (1500 centavos)
    expect(body.payment).toMatchObject({
      amountCents: 1500,
      status: "PENDING",
      qrCodeBase64: "data:image/png;base64,FAKE_DEPOSIT_QR",
      checkoutUrl: null,
    });
    expect(body.payment.paymentId).toBeTruthy();
    expect(body.payment.copyPaste).toContain("000201PIXDEPOSIT");

    // Polling público isolado pelo slug dono da cobrança
    const statusOk = await app.inject({
      method: "GET",
      url: `/public/barbearia-corte-fino/payments/${body.payment.paymentId}/status`,
    });
    expect(statusOk.statusCode).toBe(200);
    expect(statusOk.json()).toMatchObject({
      paymentId: body.payment.paymentId,
      status: "PENDING",
    });

    // Polling de outro tenant com o mesmo paymentId deve falhar com 404 (isolamento multi-tenant)
    const statusCrossTenant = await app.inject({
      method: "GET",
      url: `/public/salao-sem-gateway/payments/${body.payment.paymentId}/status`,
    });
    expect(statusCrossTenant.statusCode).toBe(404);
  });

  it("POST /public/:slug/appointments fails closed with 409 when deposit is required but no payment provider is active", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/salao-sem-gateway/appointments",
      payload: {
        serviceId: serviceCutId,
        collaboratorId,
        startsAt: slot10hUtc.toISOString(),
        clientName: "Maria Cliente",
        clientPhone: "+5511966665555",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
    });
    expect(appointmentsRepo.items).toHaveLength(0);
  });

  it("POST /public/:slug/club/subscribe enrolls customer and returns standardized Pix payment payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/club/subscribe",
      payload: {
        customerName: "Pedro Novo Assinante",
        customerPhone: "+5511955554444",
        planId: clubPlanId,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.planId).toBe(clubPlanId);
    expect(body.status).toBe("PENDING_PAYMENT");
    expect(body.payment).toMatchObject({
      amountCents: 9900,
      status: "PENDING",
      qrCodeBase64: "data:image/png;base64,FAKE_CLUB_QR",
      checkoutUrl: null,
    });
    expect(body.payment.paymentId).toBeTruthy();
    expect(body.payment.copyPaste).toContain("000201PIXCLUB");
  });

  it("POST /public/:slug/waitlist adds customer to smart waitlist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/public/barbearia-corte-fino/waitlist",
      payload: {
        customerName: "Rafael Espera",
        customerPhone: "+5511944443333",
        desiredDate: bookingDate,
        collaboratorId,
        preferredShift: "AFTERNOON",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      desiredDate: bookingDate,
      preferredShift: "AFTERNOON",
      collaboratorId,
      collaboratorName: "Lucas Barbeiro",
      status: "WAITING",
    });
  });

  it("exposes all /public/{slug}/* routes and legacy /public/companies/{companyId}/slug in OpenAPI/Swagger schema", () => {
    const spec = productionApp.swagger();
    const paths = Object.keys(spec.paths ?? {});

    expect(paths).toContain("/public/{slug}");
    expect(paths).toContain("/public/{slug}/availability");
    expect(paths).toContain("/public/{slug}/identify");
    expect(paths).toContain("/public/{slug}/appointments");
    expect(paths).toContain("/public/{slug}/club/subscribe");
    expect(paths).toContain("/public/{slug}/waitlist");
    expect(paths).toContain("/public/{slug}/payments/{paymentId}/status");
    expect(paths).toContain("/public/companies/{companyId}/slug");
  });

  it("normalizes custom slugs and rejects reserved words", () => {
    expect(normalizeCustomCompanySlug("  Barbearia São José!! ")).toBe("barbearia-sao-jose");
    expect(isValidCompanySlug("barbearia-sao-jose")).toBe(true);
    expect(isValidCompanySlug("companies")).toBe(false);
    expect(isValidCompanySlug("admin")).toBe(false);
    expect(slugifyCompanyName("Admin")).toBe("admin-shop");
  });
});
