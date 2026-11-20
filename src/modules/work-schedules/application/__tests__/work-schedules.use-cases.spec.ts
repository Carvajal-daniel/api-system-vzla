import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "../../../../shared/auth/actor-context.js";
import {
  DuplicateWorkScheduleDayError,
  InvalidDayOfWeekError,
  InvalidTimeOfDayError,
  InvalidWorkScheduleBreakError,
  InvalidWorkScheduleTimeError,
  UnauthorizedWorkScheduleActionError,
  WorkScheduleCollaboratorNotFoundError,
} from "../../domain/errors/work-schedule-errors.js";
import { ListCollaboratorWorkSchedulesUseCase } from "../use-cases/list-collaborator-work-schedules.use-case.js";
import { ListOwnWorkSchedulesUseCase } from "../use-cases/list-own-work-schedules.use-case.js";
import { UpsertCollaboratorWorkSchedulesUseCase } from "../use-cases/upsert-collaborator-work-schedules.use-case.js";
import { InMemoryWorkScheduleCollaboratorLookupRepository } from "./in-memory-collaborator-lookup.repository.js";
import { InMemoryWorkSchedulesRepository } from "./in-memory-work-schedules.repository.js";

describe("Work Schedules Use Cases (US3)", () => {
  const companyA = "11111111-1111-4111-8111-111111111111";
  const companyB = "22222222-2222-4222-8222-222222222222";

  const ownerA: ActorContext = {
    role: "OWNER",
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: companyA,
  };

  const ownerB: ActorContext = {
    role: "OWNER",
    userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    companyId: companyB,
  };

  const collaboratorActorA: ActorContext = {
    role: "COLLABORATOR",
    collaboratorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    companyId: companyA,
  };

  const collabAId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const collabBId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  let collaboratorLookupRepo: InMemoryWorkScheduleCollaboratorLookupRepository;
  let workSchedulesRepo: InMemoryWorkSchedulesRepository;
  let upsertUseCase: UpsertCollaboratorWorkSchedulesUseCase;
  let listUseCase: ListCollaboratorWorkSchedulesUseCase;

  beforeEach(() => {
    collaboratorLookupRepo = new InMemoryWorkScheduleCollaboratorLookupRepository();
    workSchedulesRepo = new InMemoryWorkSchedulesRepository();
    upsertUseCase = new UpsertCollaboratorWorkSchedulesUseCase(
      collaboratorLookupRepo,
      workSchedulesRepo,
    );
    listUseCase = new ListCollaboratorWorkSchedulesUseCase(
      collaboratorLookupRepo,
      workSchedulesRepo,
    );

    collaboratorLookupRepo.items.push(
      { id: collabAId, companyId: companyA },
      { id: collabBId, companyId: companyB },
    );
  });

  it("configures working days with optional break and normalizes non-working days to null times", async () => {
    const saved = await upsertUseCase.execute(ownerA, {
      collaboratorId: collabAId,
      schedules: [
        {
          dayOfWeek: 1,
          isWorkingDay: true,
          startTime: "09:00",
          endTime: "18:00",
          breakStart: "12:00",
          breakEnd: "13:00",
        },
        {
          dayOfWeek: 2,
          isWorkingDay: true,
          startTime: "10:00",
          endTime: "16:00",
        },
        {
          dayOfWeek: 0,
          isWorkingDay: false,
          startTime: "09:00",
          endTime: "18:00",
        },
      ],
    });

    expect(saved).toHaveLength(3);
    expect(saved[0]).toMatchObject({
      dayOfWeek: 0,
      isWorkingDay: false,
      startTime: null,
      endTime: null,
      breakStart: null,
      breakEnd: null,
    });
    expect(saved[1]).toMatchObject({
      dayOfWeek: 1,
      isWorkingDay: true,
      startTime: "09:00",
      endTime: "18:00",
      breakStart: "12:00",
      breakEnd: "13:00",
    });
    expect(saved[2]).toMatchObject({
      dayOfWeek: 2,
      isWorkingDay: true,
      startTime: "10:00",
      endTime: "16:00",
      breakStart: null,
      breakEnd: null,
    });
  });

  it("upserts existing days without duplicating records", async () => {
    await upsertUseCase.execute(ownerA, {
      collaboratorId: collabAId,
      schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "09:00", endTime: "18:00" }],
    });

    const updated = await upsertUseCase.execute(ownerA, {
      collaboratorId: collabAId,
      schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "08:30", endTime: "17:30" }],
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.startTime).toBe("08:30");
    expect(updated[0]?.endTime).toBe("17:30");
  });

  it("rejects endTime <= startTime and invalid HH:MM formats before persisting", async () => {
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "18:00", endTime: "09:00" }],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleTimeError);

    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "09:00", endTime: "09:00" }],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleTimeError);

    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "25:00", endTime: "26:00" }],
      }),
    ).rejects.toBeInstanceOf(InvalidTimeOfDayError);

    expect(workSchedulesRepo.items).toHaveLength(0);
  });

  it("rejects incomplete or out-of-range break intervals before persisting", async () => {
    // Missing breakEnd
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "18:00",
            breakStart: "12:00",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleBreakError);

    // breakEnd <= breakStart
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "18:00",
            breakStart: "13:00",
            breakEnd: "12:00",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleBreakError);

    // breakStart <= startTime
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "18:00",
            breakStart: "09:00",
            breakEnd: "10:00",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleBreakError);

    // breakEnd >= endTime
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [
          {
            dayOfWeek: 1,
            isWorkingDay: true,
            startTime: "09:00",
            endTime: "18:00",
            breakStart: "17:00",
            breakEnd: "18:00",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkScheduleBreakError);

    expect(workSchedulesRepo.items).toHaveLength(0);
  });

  it("rejects out-of-range dayOfWeek and duplicate days in the same batch", async () => {
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: 7, isWorkingDay: false }],
      }),
    ).rejects.toBeInstanceOf(InvalidDayOfWeekError);

    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: -1, isWorkingDay: false }],
      }),
    ).rejects.toBeInstanceOf(InvalidDayOfWeekError);

    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabAId,
        schedules: [
          { dayOfWeek: 1, isWorkingDay: false },
          { dayOfWeek: 1, isWorkingDay: true, startTime: "09:00", endTime: "18:00" },
        ],
      }),
    ).rejects.toBeInstanceOf(DuplicateWorkScheduleDayError);

    expect(workSchedulesRepo.items).toHaveLength(0);
  });

  it("enforces companyId isolation and rejects COLLABORATOR mutations", async () => {
    await expect(
      upsertUseCase.execute(ownerA, {
        collaboratorId: collabBId,
        schedules: [{ dayOfWeek: 1, isWorkingDay: false }],
      }),
    ).rejects.toBeInstanceOf(WorkScheduleCollaboratorNotFoundError);

    await expect(listUseCase.execute(ownerB, collabAId)).rejects.toBeInstanceOf(
      WorkScheduleCollaboratorNotFoundError,
    );

    await expect(
      upsertUseCase.execute(collaboratorActorA, {
        collaboratorId: collabAId,
        schedules: [{ dayOfWeek: 1, isWorkingDay: false }],
      }),
    ).rejects.toBeInstanceOf(UnauthorizedWorkScheduleActionError);

    await expect(listUseCase.execute(collaboratorActorA, collabAId)).rejects.toBeInstanceOf(
      UnauthorizedWorkScheduleActionError,
    );
  });

  it("allows a COLLABORATOR to read only their own work schedules (US4)", async () => {
    const secondCollabAId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    collaboratorLookupRepo.items.push({ id: secondCollabAId, companyId: companyA });

    await upsertUseCase.execute(ownerA, {
      collaboratorId: collabAId,
      schedules: [{ dayOfWeek: 1, isWorkingDay: true, startTime: "09:00", endTime: "18:00" }],
    });
    await upsertUseCase.execute(ownerA, {
      collaboratorId: secondCollabAId,
      schedules: [{ dayOfWeek: 2, isWorkingDay: true, startTime: "10:00", endTime: "19:00" }],
    });

    const listOwnUseCase = new ListOwnWorkSchedulesUseCase(workSchedulesRepo);
    const ownSchedules = await listOwnUseCase.execute(collaboratorActorA);

    expect(ownSchedules).toHaveLength(1);
    expect(ownSchedules[0]).toMatchObject({
      collaboratorId: collabAId,
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
    });

    await expect(listOwnUseCase.execute(ownerA)).rejects.toBeInstanceOf(
      UnauthorizedWorkScheduleActionError,
    );
  });
});
