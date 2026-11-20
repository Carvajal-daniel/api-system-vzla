import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import { Appointment } from "../../domain/entities/appointment.entity.js";
import {
  ScheduleBlockNotFoundError,
  SchedulingCollaboratorNotFoundError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import type {
  AbsenceNotificationPayload,
  AbsenceNotificationPort,
} from "../ports/absence-notification.port.js";
import { CreateScheduleBlockUseCase } from "../use-cases/create-schedule-block.use-case.js";
import { DeleteScheduleBlockUseCase } from "../use-cases/delete-schedule-block.use-case.js";
import { ListScheduleBlocksUseCase } from "../use-cases/list-schedule-blocks.use-case.js";
import { InMemoryAppointmentsRepository } from "./in-memory-appointments.repository.js";
import { InMemoryScheduleBlocksRepository } from "./in-memory-schedule-blocks.repository.js";
import { InMemorySchedulingContextLookupRepository } from "./in-memory-scheduling-context-lookup.repository.js";

describe("Schedule Blocks Use Cases", () => {
  let blocksRepo: InMemoryScheduleBlocksRepository;
  let appointmentsRepo: InMemoryAppointmentsRepository;
  let lookupRepo: InMemorySchedulingContextLookupRepository;
  let notificationPayloads: AbsenceNotificationPayload[];
  let notificationPort: AbsenceNotificationPort;
  let createBlock: CreateScheduleBlockUseCase;
  let listBlocks: ListScheduleBlocksUseCase;
  let deleteBlock: DeleteScheduleBlockUseCase;

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
    blocksRepo = new InMemoryScheduleBlocksRepository();
    appointmentsRepo = new InMemoryAppointmentsRepository();
    lookupRepo = new InMemorySchedulingContextLookupRepository();
    notificationPayloads = [];
    notificationPort = {
      notifyAffectedAppointments: vi.fn(async (payload) => {
        notificationPayloads.push(payload);
      }),
    };

    lookupRepo.addCollaborator({
      id: "collab-a1",
      companyId: "company-a",
      name: "Carlos",
      isActive: true,
    });
    lookupRepo.addCollaborator({
      id: "collab-a2",
      companyId: "company-a",
      name: "Ana",
      isActive: true,
    });

    createBlock = new CreateScheduleBlockUseCase(
      blocksRepo,
      appointmentsRepo,
      lookupRepo,
      notificationPort,
    );
    listBlocks = new ListScheduleBlocksUseCase(blocksRepo);
    deleteBlock = new DeleteScheduleBlockUseCase(blocksRepo);
  });

  it("allows OWNER to create company-wide and collaborator blocks, returning only active affectedAppointments and triggering AbsenceNotificationPort", async () => {
    const pendingAppt = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a1",
      serviceId: "service-a1",
      clientName: "João Silva",
      clientPhone: "+5511999998888",
      startsAt: new Date("2026-11-25T14:00:00.000Z"),
      initialStatus: "PENDING",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 4000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 40,
    });

    const confirmedAppt = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a2",
      serviceId: "service-a1",
      clientName: "Maria Souza",
      clientPhone: "+5511988887777",
      startsAt: new Date("2026-11-25T14:15:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 4000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 40,
    });

    const canceledAppt = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a1",
      serviceId: "service-a1",
      clientName: "Pedro Cancelado",
      clientPhone: "+584141234567",
      startsAt: new Date("2026-11-25T14:30:00.000Z"),
      initialStatus: "PENDING",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 4000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 40,
    });
    canceledAppt.transitionStatus("CANCELED");

    const noShowAppt = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a1",
      serviceId: "service-a1",
      clientName: "Luis NoShow",
      clientPhone: "+584121234567",
      startsAt: new Date("2026-11-25T14:30:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 4000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 40,
    });
    noShowAppt.transitionStatus("NO_SHOW");

    appointmentsRepo.items.push(
      pendingAppt,
      confirmedAppt,
      canceledAppt,
      noShowAppt,
    );

    const result = await createBlock.execute({
      actor: ownerA,
      collaboratorId: null,
      startsAt: new Date("2026-11-25T14:00:00.000Z"),
      endsAt: new Date("2026-11-25T16:00:00.000Z"),
      reason: "Feriado local",
    });

    expect(result.block.collaboratorId).toBeNull();
    expect(result.block.reason).toBe("Feriado local");
    expect(result.affectedAppointments.map((a) => a.id)).toEqual([
      pendingAppt.id,
      confirmedAppt.id,
    ]);
    expect(notificationPort.notifyAffectedAppointments).toHaveBeenCalledTimes(1);
    expect(notificationPayloads[0]?.affectedAppointments).toHaveLength(2);
  });

  it("allows COLLABORATOR to create personal block with affectedAppointments and blocks access to other collaborators or company-wide", async () => {
    const ownActive = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a1",
      serviceId: "service-a1",
      clientName: "Cliente Próprio",
      clientPhone: "+584141234567",
      startsAt: new Date("2026-11-25T15:00:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Barba",
      servicePriceInCentsSnapshot: 2000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 35,
    });
    const otherCollabActive = Appointment.create({
      companyId: "company-a",
      collaboratorId: "collab-a2",
      serviceId: "service-a1",
      clientName: "Cliente Outro",
      clientPhone: "+5511999997777",
      startsAt: new Date("2026-11-25T15:00:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Barba",
      servicePriceInCentsSnapshot: 2000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 35,
    });
    appointmentsRepo.items.push(ownActive, otherCollabActive);

    const created = await createBlock.execute({
      actor: collabA1,
      startsAt: new Date("2026-11-25T15:00:00.000Z"),
      endsAt: new Date("2026-11-25T16:00:00.000Z"),
      reason: "Consulta médica",
    });

    expect(created.block.collaboratorId).toBe("collab-a1");
    expect(created.affectedAppointments.map((a) => a.id)).toEqual([ownActive.id]);
    expect(notificationPort.notifyAffectedAppointments).toHaveBeenCalledTimes(1);

    // Colaborador não pode criar bloqueio global nem de outro colaborador
    await expect(
      createBlock.execute({
        actor: collabA1,
        collaboratorId: null,
        startsAt: new Date("2026-11-25T17:00:00.000Z"),
        endsAt: new Date("2026-11-25T18:00:00.000Z"),
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);

    await expect(
      createBlock.execute({
        actor: collabA1,
        collaboratorId: "collab-a2",
        startsAt: new Date("2026-11-25T17:00:00.000Z"),
        endsAt: new Date("2026-11-25T18:00:00.000Z"),
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);

    // Outro colaborador não pode deletar bloqueio de collabA1
    await expect(
      deleteBlock.execute({ actor: collabA2, blockId: created.block.id }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);

    // Multi-tenant: ownerB não encontra nem deleta bloqueio da company-a
    await expect(
      deleteBlock.execute({ actor: ownerB, blockId: created.block.id }),
    ).rejects.toThrow(ScheduleBlockNotFoundError);

    // Próprio colaborador lista e deleta seu bloqueio
    const listed = await listBlocks.execute({ actor: collabA1 });
    expect(listed).toHaveLength(1);
    await deleteBlock.execute({ actor: collabA1, blockId: created.block.id });
    expect(await listBlocks.execute({ actor: collabA1 })).toHaveLength(0);
  });

  it("rejects OWNER creating a block for a collaborator from another company", async () => {
    await expect(
      createBlock.execute({
        actor: ownerB,
        collaboratorId: "collab-a1",
        startsAt: new Date("2026-11-25T14:00:00.000Z"),
        endsAt: new Date("2026-11-25T15:00:00.000Z"),
      }),
    ).rejects.toThrow(SchedulingCollaboratorNotFoundError);
  });
});
