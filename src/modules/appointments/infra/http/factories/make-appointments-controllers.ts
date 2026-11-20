import type { AbsenceNotificationPort } from "../../../application/ports/absence-notification.port.js";
import { CreateAppointmentUseCase } from "../../../application/use-cases/create-appointment.use-case.js";
import { CreateScheduleBlockUseCase } from "../../../application/use-cases/create-schedule-block.use-case.js";
import { DeleteScheduleBlockUseCase } from "../../../application/use-cases/delete-schedule-block.use-case.js";
import { GetAvailabilityUseCase } from "../../../application/use-cases/get-availability.use-case.js";
import { ListAppointmentsUseCase } from "../../../application/use-cases/list-appointments.use-case.js";
import { ListScheduleBlocksUseCase } from "../../../application/use-cases/list-schedule-blocks.use-case.js";
import { RescheduleAppointmentUseCase } from "../../../application/use-cases/reschedule-appointment.use-case.js";
import { UpdateAppointmentStatusUseCase } from "../../../application/use-cases/update-appointment-status.use-case.js";
import type { AppointmentsRepository } from "../../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../../domain/repositories/scheduling-context-lookup.repository.js";
import { DrizzleAppointmentsRepository } from "../../database/repositories/drizzle-appointments.repository.js";
import { DrizzleScheduleBlocksRepository } from "../../database/repositories/drizzle-schedule-blocks.repository.js";
import { DrizzleSchedulingContextLookupRepository } from "../../database/repositories/drizzle-scheduling-context-lookup.repository.js";
import { NoopAbsenceNotificationAdapter } from "../../notifications/noop-absence-notification.adapter.js";
import { AppointmentsController } from "../controllers/appointments.controller.js";
import { ScheduleBlocksController } from "../controllers/schedule-blocks.controller.js";

export interface AppointmentsDependencies {
  scheduleBlocksRepository?: ScheduleBlocksRepository;
  appointmentsRepository?: AppointmentsRepository;
  lookupRepository?: SchedulingContextLookupRepository;
  absenceNotificationPort?: AbsenceNotificationPort;
}

export function makeAppointmentsControllers(
  deps: AppointmentsDependencies = {},
): {
  scheduleBlocksController: ScheduleBlocksController;
  appointmentsController: AppointmentsController;
} {
  const scheduleBlocksRepository =
    deps.scheduleBlocksRepository ?? new DrizzleScheduleBlocksRepository();
  const appointmentsRepository =
    deps.appointmentsRepository ?? new DrizzleAppointmentsRepository();
  const lookupRepository =
    deps.lookupRepository ?? new DrizzleSchedulingContextLookupRepository();
  const absenceNotificationPort =
    deps.absenceNotificationPort ?? new NoopAbsenceNotificationAdapter();

  const scheduleBlocksController = new ScheduleBlocksController(
    new CreateScheduleBlockUseCase(
      scheduleBlocksRepository,
      appointmentsRepository,
      lookupRepository,
      absenceNotificationPort,
    ),
    new ListScheduleBlocksUseCase(scheduleBlocksRepository),
    new DeleteScheduleBlockUseCase(scheduleBlocksRepository),
  );

  const appointmentsController = new AppointmentsController(
    new GetAvailabilityUseCase(
      lookupRepository,
      scheduleBlocksRepository,
      appointmentsRepository,
    ),
    new CreateAppointmentUseCase(
      lookupRepository,
      scheduleBlocksRepository,
      appointmentsRepository,
    ),
    new ListAppointmentsUseCase(appointmentsRepository),
    new UpdateAppointmentStatusUseCase(appointmentsRepository),
    new RescheduleAppointmentUseCase(
      lookupRepository,
      scheduleBlocksRepository,
      appointmentsRepository,
    ),
  );

  return { scheduleBlocksController, appointmentsController };
}
