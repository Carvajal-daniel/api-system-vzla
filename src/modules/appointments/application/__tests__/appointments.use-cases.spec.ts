import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { ScheduleBlock } from "../../domain/entities/schedule-block.entity.js";
import {
  AppointmentBlockedError,
  AppointmentDuringBreakError,
  AppointmentInPastError,
  AppointmentNotFoundError,
  AppointmentOutsideWorkScheduleError,
  AppointmentTimeConflictError,
  InvalidAppointmentStatusTransitionError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import { localDateTimeToUtc } from "../../domain/services/timezone-utils.js";
import { CreateAppointmentUseCase } from "../use-cases/create-appointment.use-case.js";
import { GetAvailabilityUseCase } from "../use-cases/get-availability.use-case.js";
import { ListAppointmentsUseCase } from "../use-cases/list-appointments.use-case.js";
import { RescheduleAppointmentUseCase } from "../use-cases/reschedule-appointment.use-case.js";
import { UpdateAppointmentStatusUseCase } from "../use-cases/update-appointment-status.use-case.js";
import { InMemoryAppointmentsRepository } from "./in-memory-appointments.repository.js";
import { InMemoryScheduleBlocksRepository } from "./in-memory-schedule-blocks.repository.js";
import { InMemorySchedulingContextLookupRepository } from "./in-memory-scheduling-context-lookup.repository.js";

describe("Appointments & Availability Use Cases", () => {
  let lookupRepo: InMemorySchedulingContextLookupRepository;
  let blocksRepo: InMemoryScheduleBlocksRepository;
  let appointmentsRepo: InMemoryAppointmentsRepository;

  let getAvailability: GetAvailabilityUseCase;
  let createAppointment: CreateAppointmentUseCase;
  let listAppointments: ListAppointmentsUseCase;
  let updateStatus: UpdateAppointmentStatusUseCase;
  let rescheduleAppointment: RescheduleAppointmentUseCase;

  const tzBrazil = "America/Sao_Paulo";
  // 2026-11-25 é quarta-feira (dayOfWeek = 3)
  const now = localDateTimeToUtc(2026, 11, 25, 8, 0, tzBrazil);

  const ownerA: ActorContext = {
    role: "OWNER",
    userId: "owner-a",
    companyId: "company-a",
  };
  const ownerB: ActorContext = {
    role: "OWNER",
    userId: "owner-b",
    companyId: "company-b",
  };
  const collabA1: ActorContext = {
    role: "COLLABORATOR",
    collaboratorId: "collab-a1",
    companyId: "company-a",
  };
  const collabA2: ActorContext = {
    role: "COLLABORATOR",
    collaboratorId: "collab-a2",
    companyId: "company-a",
  };

  beforeEach(() => {
    lookupRepo = new InMemorySchedulingContextLookupRepository();
    blocksRepo = new InMemoryScheduleBlocksRepository();
    appointmentsRepo = new InMemoryAppointmentsRepository();

    lookupRepo.addCompany({
      id: "company-a",
      companyName: "Barbearia Brasil",
      timezone: tzBrazil,
      isActive: true,
    });
    lookupRepo.addService({
      id: "service-cut",
      companyId: "company-a",
      name: "Corte Degradê",
      durationMinutes: 30,
      priceInCents: 4500,
      active: true,
    });
    lookupRepo.addCollaborator({
      id: "collab-a1",
      companyId: "company-a",
      name: "Lucas",
      isActive: true,
    });
    lookupRepo.addCollaborator({
      id: "collab-a2",
      companyId: "company-a",
      name: "Rafael",
      isActive: true,
    });
    lookupRepo.linkCollaboratorToService("company-a", "service-cut", "collab-a1", 40);
    lookupRepo.linkCollaboratorToService("company-a", "service-cut", "collab-a2", 50);

    lookupRepo.setWorkSchedule("company-a", "collab-a1", {
      dayOfWeek: 3,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "12:00",
      breakStart: "10:30",
      breakEnd: "11:00",
    });
    lookupRepo.setWorkSchedule("company-a", "collab-a2", {
      dayOfWeek: 3,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "10:00",
      breakStart: null,
      breakEnd: null,
    });

    getAvailability = new GetAvailabilityUseCase(
      lookupRepo,
      blocksRepo,
      appointmentsRepo,
    );
    createAppointment = new CreateAppointmentUseCase(
      lookupRepo,
      blocksRepo,
      appointmentsRepo,
    );
    listAppointments = new ListAppointmentsUseCase(appointmentsRepo);
    updateStatus = new UpdateAppointmentStatusUseCase(appointmentsRepo);
    rescheduleAppointment = new RescheduleAppointmentUseCase(
      lookupRepo,
      blocksRepo,
      appointmentsRepo,
    );
  });

  it("uses the replacement professional's commission rate after reassignment", async () => {
    const startsAt = localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil);
    const created = await createAppointment.executeInternal({
      actor: ownerA,
      serviceId: "service-cut",
      collaboratorId: "collab-a1",
      startsAt,
      clientName: "Cliente",
      clientPhone: "+5511987654321",
      now,
    });
    expect(created.commissionPercentageSnapshot).toBe(40);
    const reassigned = await rescheduleAppointment.execute({
      actor: ownerA,
      appointmentId: created.id,
      collaboratorId: "collab-a2",
      startsAt,
      now,
    });
    expect(reassigned.collaboratorId).toBe("collab-a2");
    expect(reassigned.commissionPercentageSnapshot).toBe(50);
    expect(reassigned.servicePriceInCentsSnapshot).toBe(created.servicePriceInCentsSnapshot);
  });

  it("creates public appointment as PENDING with derived endsAt and immutable snapshots", async () => {
    const startsAt = localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil);

    const created = await createAppointment.executePublic({
      companyId: "company-a",
      serviceId: "service-cut",
      collaboratorId: "collab-a1",
      startsAt,
      clientName: "Gabriel Costa",
      clientPhone: "+55 (11) 98765-4321",
      now,
    });

    expect(created.status).toBe("PENDING");
    expect(created.clientPhone).toBe("+5511987654321");
    expect(created.endsAt).toBe(
      localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil).toISOString(),
    );
    expect(created.servicePriceInCentsSnapshot).toBe(4500);
    expect(created.serviceDurationMinutesSnapshot).toBe(30);
    expect(created.commissionPercentageSnapshot).toBe(40);

    // Alterações posteriores no catálogo e na comissão não afetam o agendamento já criado.
    lookupRepo.addService({
      id: "service-cut",
      companyId: "company-a",
      name: "Corte Premium",
      durationMinutes: 60,
      priceInCents: 9000,
      active: true,
    });
    lookupRepo.linkCollaboratorToService("company-a", "service-cut", "collab-a1", 55);

    const listed = await listAppointments.execute({ actor: ownerA });
    expect(listed[0]?.serviceNameSnapshot).toBe("Corte Degradê");
    expect(listed[0]?.servicePriceInCentsSnapshot).toBe(4500);
    expect(listed[0]?.serviceDurationMinutesSnapshot).toBe(30);
    expect(listed[0]?.commissionPercentageSnapshot).toBe(40);
  });

  it("allows OWNER to create appointment directly as CONFIRMED and blocks COLLABORATOR from creating appointments", async () => {
    const startsAt = localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil);

    const ownerCreated = await createAppointment.executeInternal({
      actor: ownerA,
      serviceId: "service-cut",
      collaboratorId: "collab-a1",
      startsAt,
      clientName: "Cliente VIP",
      clientPhone: "+58 414-123-4567",
      initialStatus: "CONFIRMED",
      now,
    });

    expect(ownerCreated.status).toBe("CONFIRMED");
    expect(ownerCreated.clientPhone).toBe("+584141234567");

    await expect(
      createAppointment.executeInternal({
        actor: collabA1,
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt: localDateTimeToUtc(2026, 11, 25, 11, 0, tzBrazil),
        clientName: "Tentativa Collab",
        clientPhone: "+5511999990000",
        now,
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);
  });

  it("validates past, work schedule, break and schedule blocks directly without prior /availability lookup", async () => {
    // Passado
    await expect(
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt: localDateTimeToUtc(2026, 11, 25, 7, 30, tzBrazil),
        clientName: "Cliente",
        clientPhone: "+5511987654321",
        now,
      }),
    ).rejects.toThrow(AppointmentInPastError);

    // Fora do expediente
    await expect(
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt: localDateTimeToUtc(2026, 11, 25, 12, 0, tzBrazil),
        clientName: "Cliente",
        clientPhone: "+5511987654321",
        now,
      }),
    ).rejects.toThrow(AppointmentOutsideWorkScheduleError);

    // Durante descanso (10:30-11:00)
    await expect(
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt: localDateTimeToUtc(2026, 11, 25, 10, 30, tzBrazil),
        clientName: "Cliente",
        clientPhone: "+5511987654321",
        now,
      }),
    ).rejects.toThrow(AppointmentDuringBreakError);

    // Bloqueio global da empresa
    await blocksRepo.create(
      ScheduleBlock.create({
        companyId: "company-a",
        collaboratorId: null,
        startsAt: localDateTimeToUtc(2026, 11, 25, 11, 0, tzBrazil),
        endsAt: localDateTimeToUtc(2026, 11, 25, 12, 0, tzBrazil),
        reason: "Manutenção",
      }),
    );

    await expect(
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt: localDateTimeToUtc(2026, 11, 25, 11, 0, tzBrazil),
        clientName: "Cliente",
        clientPhone: "+5511987654321",
        now,
      }),
    ).rejects.toThrow(AppointmentBlockedError);
  });

  it("prevents double-booking under concurrent Promise.all requests using repository lock (1 created, 1 conflict 409)", async () => {
    const startsAt = localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil);

    const results = await Promise.allSettled([
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt,
        clientName: "Cliente 1",
        clientPhone: "+5511987654321",
        now,
      }),
      createAppointment.executePublic({
        companyId: "company-a",
        serviceId: "service-cut",
        collaboratorId: "collab-a1",
        startsAt,
        clientName: "Cliente 2",
        clientPhone: "+5511987654322",
        now,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(
      AppointmentTimeConflictError,
    );
    expect(appointmentsRepo.items).toHaveLength(1);
  });

  it("evaluates availability for any collaborator and frees slots immediately on CANCELED or NO_SHOW", async () => {
    const startsAt = localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil);

    const created = await createAppointment.executePublic({
      companyId: "company-a",
      serviceId: "service-cut",
      collaboratorId: "collab-a2",
      startsAt,
      clientName: "Cliente Teste",
      clientPhone: "+5511987654321",
      now,
    });

    // Com agendamento PENDING às 09:00-09:30 para collab-a2 (jornada 09:00-10:00), só sobra 09:30 para collab-a2
    const beforeCancel = await getAvailability.execute({
      companyId: "company-a",
      serviceId: "service-cut",
      date: "2026-11-25",
      collaboratorId: "collab-a2",
      now,
    });
    expect(beforeCancel.slots.map((s) => s.startsAt)).toEqual([
      localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil).toISOString(),
    ]);

    // Cancelar libera o slot de 09:00 imediatamente.
    await updateStatus.execute({
      actor: collabA2,
      appointmentId: created.id,
      status: "CANCELED",
      cancellationReason: "Cliente desistiu",
    });

    const afterCancel = await getAvailability.execute({
      companyId: "company-a",
      serviceId: "service-cut",
      date: "2026-11-25",
      collaboratorId: "collab-a2",
      now,
    });
    expect(afterCancel.slots.map((s) => s.startsAt)).toEqual([
      localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil).toISOString(),
      localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil).toISOString(),
    ]);

    // Consulta sem collaboratorId agrega ambos os colaboradores habilitados
    const anyCollab = await getAvailability.execute({
      companyId: "company-a",
      serviceId: "service-cut",
      date: "2026-11-25",
      now,
    });
    const collabIds = new Set(anyCollab.slots.map((s) => s.collaboratorId));
    expect(collabIds.has("collab-a1")).toBe(true);
    expect(collabIds.has("collab-a2")).toBe(true);
  });

  it("enforces RBAC, tenant isolation, status transitions and atomic rescheduling excluding self", async () => {
    const created = await createAppointment.executePublic({
      companyId: "company-a",
      serviceId: "service-cut",
      collaboratorId: "collab-a1",
      startsAt: localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil),
      clientName: "Cliente Agenda",
      clientPhone: "+5511987654321",
      now,
    });

    // Collab A2 não pode alterar status de cita de Collab A1
    await expect(
      updateStatus.execute({
        actor: collabA2,
        appointmentId: created.id,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);

    // Owner B (outro tenant) não encontra cita da company-a
    await expect(
      updateStatus.execute({
        actor: ownerB,
        appointmentId: created.id,
        status: "CONFIRMED",
      }),
    ).rejects.toThrow(AppointmentNotFoundError);

    // Reagendar para o próprio horário deve ignorar o ID no conflito.
    const rescheduled = await rescheduleAppointment.execute({
      actor: ownerA,
      appointmentId: created.id,
      startsAt: localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil),
      now,
    });
    expect(rescheduled.startsAt).toBe(
      localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil).toISOString(),
    );
    expect(rescheduled.endsAt).toBe(
      localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil).toISOString(),
    );

    // Colaborador não pode reprogramar
    await expect(
      rescheduleAppointment.execute({
        actor: collabA1,
        appointmentId: created.id,
        startsAt: localDateTimeToUtc(2026, 11, 25, 11, 0, tzBrazil),
        now,
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);

    // Transição válida PENDING -> CONFIRMED -> COMPLETED e bloqueio de transição terminal
    const confirmed = await updateStatus.execute({
      actor: collabA1,
      appointmentId: created.id,
      status: "CONFIRMED",
    });
    expect(confirmed.status).toBe("CONFIRMED");

    await expect(updateStatus.execute({
      actor: collabA1,
      appointmentId: created.id,
      status: "COMPLETED",
      now: new Date(Date.parse(rescheduled.startsAt) - 1),
    })).rejects.toThrow("Cannot complete an appointment before it ends.");

    await expect(updateStatus.execute({
      actor: collabA1,
      appointmentId: created.id,
      status: "COMPLETED",
      now: new Date(Date.parse(rescheduled.endsAt) - 1),
    })).rejects.toThrow("Cannot complete an appointment before it ends.");

    const completed = await updateStatus.execute({
      now: new Date(rescheduled.endsAt),
      actor: collabA1,
      appointmentId: created.id,
      status: "COMPLETED",
    });
    expect(completed.status).toBe("COMPLETED");

    await expect(
      updateStatus.execute({
        actor: ownerA,
        appointmentId: created.id,
        status: "CANCELED",
      }),
    ).rejects.toThrow(InvalidAppointmentStatusTransitionError);
  });

  it("permite que chamadas com actorSource WHATSAPP_AI criem, reagendem e atualizem agendamentos", async () => {
    // Criação via WhatsApp AI simulando ator do sistema
    const aiCreated = await createAppointment.executeInternal({
      actor: ownerA,
      actorSource: "WHATSAPP_AI",
      serviceId: "service-cut",
      collaboratorId: "collab-a1",
      startsAt: localDateTimeToUtc(2026, 11, 25, 9, 0, tzBrazil),
      clientName: "Cliente WhatsApp",
      clientPhone: "+5511999998888",
      notes: "Agendado via IA WhatsApp",
      now,
    });
    expect(aiCreated.id).toBeDefined();
    expect(aiCreated.clientName).toBe("Cliente WhatsApp");

    // Reagendamento via WhatsApp AI
    const aiRescheduled = await rescheduleAppointment.execute({
      actor: collabA1, // Mesmo que o contexto seja não-owner, actorSource WHATSAPP_AI é autorizado
      actorSource: "WHATSAPP_AI",
      appointmentId: aiCreated.id,
      startsAt: localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil),
      now,
    });
    expect(aiRescheduled.startsAt).toBe(
      localDateTimeToUtc(2026, 11, 25, 9, 30, tzBrazil).toISOString(),
    );

    // Cancelamento via WhatsApp AI
    const aiCanceled = await updateStatus.execute({
      actor: collabA2, // Outro colaborador, mas com WHATSAPP_AI
      actorSource: "WHATSAPP_AI",
      appointmentId: aiCreated.id,
      status: "CANCELED",
      cancellationReason: "Cancelado pelo cliente via WhatsApp",
      now,
    });
    expect(aiCanceled.status).toBe("CANCELED");
    expect(aiCanceled.cancellationReason).toBe("Cancelado pelo cliente via WhatsApp");
  });
});
