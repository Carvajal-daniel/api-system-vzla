import fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryAppointmentsRepository } from "../../../modules/appointments/application/__tests__/in-memory-appointments.repository.js";
import { InMemoryScheduleBlocksRepository } from "../../../modules/appointments/application/__tests__/in-memory-schedule-blocks.repository.js";
import { InMemorySchedulingContextLookupRepository } from "../../../modules/appointments/application/__tests__/in-memory-scheduling-context-lookup.repository.js";
import { localDateTimeToUtc } from "../../../modules/appointments/domain/services/timezone-utils.js";
import { appointmentsRoutes } from "../../../modules/appointments/infra/http/routes/appointments.routes.js";
import { NoopAbsenceNotificationAdapter } from "../../../modules/appointments/infra/notifications/noop-absence-notification.adapter.js";
import { app as productionApp } from "../App.js";
import {
  resetActorStatusVerifier,
  setActorStatusVerifier,
} from "../auth/authenticate.js";
import { registerErrorHandler } from "../error-handler.js";

describe("Appointments, Availability & Schedule Blocks HTTP Layer (JWT, RBAC, Multi-Tenant, Multi-Country, Concurrency & OpenAPI)", () => {
  const testSecret = "vitest-appointments-http-secret";
  const previousSecret = process.env.JWT_SECRET;

  // Empresa Brasil (America/Sao_Paulo) e Empresa Venezuela (America/Caracas)
  const companyBrId = "11111111-1111-4111-8111-111111111111";
  const companyVeId = "22222222-2222-4222-8222-222222222222";
  const ownerBrId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const ownerVeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const collabBrId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const collabVeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const serviceBrId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const serviceVeId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

  let ownerBrToken: string;
  let ownerVeToken: string;
  let collabBrToken: string;

  let blocksRepo: InMemoryScheduleBlocksRepository;
  let appointmentsRepo: InMemoryAppointmentsRepository;
  let lookupRepo: InMemorySchedulingContextLookupRepository;
  let testApp: ReturnType<typeof fastify>;

  // Data futura fixa (quarta-feira, dayOfWeek = 3) para garantir startsAt > now.
  const futureDate = "2030-05-15";

  beforeAll(async () => {
    process.env.JWT_SECRET = testSecret;
    setActorStatusVerifier(async () => true);
    await productionApp.ready();

    ownerBrToken = jwt.sign(
      { sub: ownerBrId, companyId: companyBrId, role: "OWNER" },
      testSecret,
    );
    ownerVeToken = jwt.sign(
      { sub: ownerVeId, companyId: companyVeId, role: "OWNER" },
      testSecret,
    );
    collabBrToken = jwt.sign(
      { sub: collabBrId, companyId: companyBrId, role: "COLLABORATOR" },
      testSecret,
    );
  });

  beforeEach(async () => {
    blocksRepo = new InMemoryScheduleBlocksRepository();
    appointmentsRepo = new InMemoryAppointmentsRepository();
    lookupRepo = new InMemorySchedulingContextLookupRepository();

    lookupRepo.addCompany({
      id: companyBrId,
      companyName: "Barbearia São Paulo",
      timezone: "America/Sao_Paulo",
      isActive: true,
    });
    lookupRepo.addCompany({
      id: companyVeId,
      companyName: "Barbería Maturín",
      timezone: "America/Caracas",
      isActive: true,
    });

    lookupRepo.addService({
      id: serviceBrId,
      companyId: companyBrId,
      name: "Corte Degradê",
      durationMinutes: 30,
      priceInCents: 4500,
      active: true,
    });
    lookupRepo.addService({
      id: serviceVeId,
      companyId: companyVeId,
      name: "Corte Clásico",
      durationMinutes: 30,
      priceInCents: 1500,
      active: true,
    });

    lookupRepo.addCollaborator({
      id: collabBrId,
      companyId: companyBrId,
      name: "Lucas",
      isActive: true,
    });
    lookupRepo.addCollaborator({
      id: collabVeId,
      companyId: companyVeId,
      name: "Carlos",
      isActive: true,
    });

    lookupRepo.linkCollaboratorToService(companyBrId, serviceBrId, collabBrId, 40);
    lookupRepo.linkCollaboratorToService(companyVeId, serviceVeId, collabVeId, 45);

    lookupRepo.setWorkSchedule(companyBrId, collabBrId, {
      dayOfWeek: 3,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "12:00",
      breakStart: "10:30",
      breakEnd: "11:00",
    });
    lookupRepo.setWorkSchedule(companyVeId, collabVeId, {
      dayOfWeek: 3,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "12:00",
      breakStart: null,
      breakEnd: null,
    });

    testApp = fastify({ logger: false });
    registerErrorHandler(testApp);
    await testApp.register(async (instance: FastifyInstance) => {
      await appointmentsRoutes(instance, {
        scheduleBlocksRepository: blocksRepo,
        appointmentsRepository: appointmentsRepo,
        lookupRepository: lookupRepo,
        absenceNotificationPort: new NoopAbsenceNotificationAdapter(),
      });
    });
    await testApp.ready();
  });

  afterAll(async () => {
    resetActorStatusVerifier();
    if (previousSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = previousSecret;
    }
    await productionApp.close();
  });

  it("enforces JWT (401), RBAC (403) and Zod validation (400) including invalid IANA timezone on company endpoints", async () => {
    // 401 sem token
    const noAuth = await productionApp.inject({
      method: "GET",
      url: "/appointments",
    });
    expect(noAuth.statusCode).toBe(401);

    // 403: COLLABORATOR proibido de criar agendamento em POST /appointments e bloqueio global
    const collabCreateAppt = await productionApp.inject({
      method: "POST",
      url: "/appointments",
      headers: { authorization: `Bearer ${collabBrToken}` },
      payload: {
        serviceId: serviceBrId,
        collaboratorId: collabBrId,
        startsAt: "2030-05-15T12:00:00.000Z",
        clientName: "João",
        clientPhone: "+5511987654321",
      },
    });
    expect(collabCreateAppt.statusCode).toBe(403);

    const collabOwnerBlock = await productionApp.inject({
      method: "POST",
      url: "/schedule-blocks",
      headers: { authorization: `Bearer ${collabBrToken}` },
      payload: {
        startsAt: "2030-05-15T12:00:00.000Z",
        endsAt: "2030-05-15T13:00:00.000Z",
      },
    });
    expect(collabOwnerBlock.statusCode).toBe(403);

    // 400: timezone IANA inválido em PATCH /companies/me/timezone e POST /auth/register
    const invalidTzPatch = await productionApp.inject({
      method: "PATCH",
      url: "/companies/me/timezone",
      headers: { authorization: `Bearer ${ownerBrToken}` },
      payload: { timezone: "Mars/Olympus_Mons" },
    });
    expect(invalidTzPatch.statusCode).toBe(400);

    const invalidTzRegister = await productionApp.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        companyName: "Barbearia Teste",
        name: "Dono Teste",
        phone: "+5511987654321",
        email: "invalid-tz@test.com",
        password: "Secret@1",
        timezone: "Invalid/Timezone",
      },
    });
    expect(invalidTzRegister.statusCode).toBe(400);

    // 400: timezone IANA inválido na consulta de disponibilidade
    const invalidTzAvail = await testApp.inject({
      method: "GET",
      url: `/public/companies/${companyBrId}/availability?serviceId=${serviceBrId}&date=${futureDate}&timezone=Not/AZone`,
    });
    expect(invalidTzAvail.statusCode).toBe(400);
  });

  it("supports multi-country public booking (+55 Brazil & +58 Venezuela), OWNER CONFIRMED creation, and prevents double-booking (201 + 409)", async () => {
    // 1. Disponibilidade Brasil (America/Sao_Paulo)
    const availBr = await testApp.inject({
      method: "GET",
      url: `/public/companies/${companyBrId}/availability?serviceId=${serviceBrId}&date=${futureDate}`,
    });
    expect(availBr.statusCode).toBe(200);
    const availBrBody = availBr.json();
    expect(availBrBody.timezone).toBe("America/Sao_Paulo");
    expect(availBrBody.slotStepMinutes).toBe(15);
    expect(availBrBody.slots.length).toBeGreaterThan(0);

    // 2. Agendamento público Brasil (+55) com concorrência simultânea -> 1x 201 + 1x 409
    const brSlotStart = localDateTimeToUtc(
      2030,
      5,
      15,
      9,
      0,
      "America/Sao_Paulo",
    ).toISOString();

    const [req1, req2] = await Promise.all([
      testApp.inject({
        method: "POST",
        url: `/public/companies/${companyBrId}/appointments`,
        payload: {
          serviceId: serviceBrId,
          collaboratorId: collabBrId,
          startsAt: brSlotStart,
          clientName: "Gabriel Brasil",
          clientPhone: "+55 (11) 98765-4321",
        },
      }),
      testApp.inject({
        method: "POST",
        url: `/public/companies/${companyBrId}/appointments`,
        payload: {
          serviceId: serviceBrId,
          collaboratorId: collabBrId,
          startsAt: brSlotStart,
          clientName: "Concorrente Brasil",
          clientPhone: "+55 (11) 98765-4322",
        },
      }),
    ]);

    const statusCodes = [req1.statusCode, req2.statusCode].sort();
    expect(statusCodes).toEqual([201, 409]);

    const createdBr = req1.statusCode === 201 ? req1.json() : req2.json();
    expect(createdBr.status).toBe("PENDING");
    expect(createdBr.clientPhone).toBe("+5511987654321");
    expect(createdBr.endsAt).toBe(
      localDateTimeToUtc(2030, 5, 15, 9, 30, "America/Sao_Paulo").toISOString(),
    );

    // 3. Agendamento público Venezuela (+58, America/Caracas)
    const veSlotStart = localDateTimeToUtc(
      2030,
      5,
      15,
      9,
      0,
      "America/Caracas",
    ).toISOString();

    const veCreatedRes = await testApp.inject({
      method: "POST",
      url: `/public/companies/${companyVeId}/appointments`,
      payload: {
        serviceId: serviceVeId,
        collaboratorId: collabVeId,
        startsAt: veSlotStart,
        clientName: "María Venezuela",
        clientPhone: "+58 414-123-4567",
      },
    });
    expect(veCreatedRes.statusCode).toBe(201);
    expect(veCreatedRes.json().clientPhone).toBe("+584141234567");

    // 4. OWNER cria agendamento diretamente como CONFIRMED
    const ownerBooking = await testApp.inject({
      method: "POST",
      url: "/appointments",
      headers: { authorization: `Bearer ${ownerBrToken}` },
      payload: {
        serviceId: serviceBrId,
        collaboratorId: collabBrId,
        startsAt: localDateTimeToUtc(
          2030,
          5,
          15,
          11,
          0,
          "America/Sao_Paulo",
        ).toISOString(),
        clientName: "Cliente VIP",
        clientPhone: "+5511999991111",
        initialStatus: "CONFIRMED",
      },
    });
    expect(ownerBooking.statusCode).toBe(201);
    expect(ownerBooking.json().status).toBe("CONFIRMED");

    const earlyCompletion = await testApp.inject({
      method: "PATCH",
      url: `/appointments/${ownerBooking.json().id}/status`,
      headers: { authorization: `Bearer ${collabBrToken}` },
      payload: { status: "COMPLETED" },
    });
    expect(earlyCompletion.statusCode).toBe(400);
    expect(earlyCompletion.json().message).toBe(
      "Cannot complete an appointment before its scheduled date and time.",
    );

    // 5. Isolamento multi-tenant: OWNER da Venezuela não vê nem altera agendamento do Brasil
    const crossTenantStatus = await testApp.inject({
      method: "PATCH",
      url: `/appointments/${createdBr.id}/status`,
      headers: { authorization: `Bearer ${ownerVeToken}` },
      payload: { status: "CONFIRMED" },
    });
    expect(crossTenantStatus.statusCode).toBe(404);

    // 6. Bloqueio de horário retorna affectedAppointments com as citas ativas impactadas
    const blockRes = await testApp.inject({
      method: "POST",
      url: "/me/schedule-blocks",
      headers: { authorization: `Bearer ${collabBrToken}` },
      payload: {
        startsAt: localDateTimeToUtc(
          2030,
          5,
          15,
          8,
          30,
          "America/Sao_Paulo",
        ).toISOString(),
        endsAt: localDateTimeToUtc(
          2030,
          5,
          15,
          10,
          0,
          "America/Sao_Paulo",
        ).toISOString(),
        reason: "Imprevisto pessoal",
      },
    });
    expect(blockRes.statusCode).toBe(201);
    const blockBody = blockRes.json();
    expect(blockBody.affectedAppointments).toHaveLength(1);
    expect(blockBody.affectedAppointments[0].id).toBe(createdBr.id);

    await testApp.close();
  });

  it("exposes all 13 Etapa 3 routes and PATCH /companies/me/timezone in OpenAPI /docs/json without errors", async () => {
    const response = await productionApp.inject({
      method: "GET",
      url: "/docs/json",
    });

    expect(response.statusCode).toBe(200);
    const spec = response.json() as {
      paths?: Record<string, Record<string, unknown>>;
    };

    const expectedRoutes: Array<[string, string]> = [
      ["/schedule-blocks", "post"],
      ["/schedule-blocks", "get"],
      ["/schedule-blocks/{blockId}", "delete"],
      ["/me/schedule-blocks", "post"],
      ["/me/schedule-blocks", "get"],
      ["/me/schedule-blocks/{blockId}", "delete"],
      ["/public/companies/{companyId}/availability", "get"],
      ["/public/companies/{companyId}/appointments", "post"],
      ["/appointments", "post"],
      ["/appointments", "get"],
      ["/me/appointments", "get"],
      ["/appointments/{appointmentId}/status", "patch"],
      ["/appointments/{appointmentId}/reschedule", "patch"],
      ["/companies/me/timezone", "patch"],
    ];

    for (const [path, method] of expectedRoutes) {
      expect(spec.paths?.[path]?.[method]).toBeDefined();
    }
  });
});
