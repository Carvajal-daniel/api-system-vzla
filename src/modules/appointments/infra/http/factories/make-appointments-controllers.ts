import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../../../../../shared/database/database.js";
import { CompanyTable } from "../../../../Company/infra/database/schema/companies-schema.js";
import type { AbsenceNotificationPort } from "../../../application/ports/absence-notification.port.js";
import { CreateAppointmentUseCase } from "../../../application/use-cases/create-appointment.use-case.js";
import { CreateScheduleBlockUseCase } from "../../../application/use-cases/create-schedule-block.use-case.js";
import { DeleteScheduleBlockUseCase } from "../../../application/use-cases/delete-schedule-block.use-case.js";
import { GetAvailabilityUseCase } from "../../../application/use-cases/get-availability.use-case.js";
import { ListAppointmentsUseCase } from "../../../application/use-cases/list-appointments.use-case.js";
import { ListScheduleBlocksUseCase } from "../../../application/use-cases/list-schedule-blocks.use-case.js";
import { RescheduleAppointmentUseCase } from "../../../application/use-cases/reschedule-appointment.use-case.js";
import {
  type OwnerAuthorizationVerifier,
  RevertCompletedAppointmentUseCase,
} from "../../../application/use-cases/revert-completed-appointment.use-case.js";
import { UpdateAppointmentStatusUseCase } from "../../../application/use-cases/update-appointment-status.use-case.js";
import type { AppointmentsRepository } from "../../../domain/repositories/appointments.repository.js";
import type { ScheduleBlocksRepository } from "../../../domain/repositories/schedule-blocks.repository.js";
import type { SchedulingContextLookupRepository } from "../../../domain/repositories/scheduling-context-lookup.repository.js";
import { DrizzleAppointmentsRepository } from "../../database/repositories/drizzle-appointments.repository.js";
import { DrizzleScheduleBlocksRepository } from "../../database/repositories/drizzle-schedule-blocks.repository.js";
import { DrizzleSchedulingContextLookupRepository } from "../../database/repositories/drizzle-scheduling-context-lookup.repository.js";
import { DrizzleClientsRepository } from "../../../../clients/infra/database/repositories/drizzle-clients.repository.js";
import { AesSecretCipher } from "../../../../whatsapp/infra/crypto/aes-secret-cipher.js";
import { DrizzleCompanyWhatsAppConnectionRepository } from "../../../../whatsapp/infra/database/repositories/drizzle-company-whatsapp-connection.repository.js";
import { DrizzleWhatsAppConversationsRepository } from "../../../../whatsapp/infra/database/repositories/drizzle-whatsapp-conversations.repository.js";
import { DrizzleWhatsAppMessagesRepository } from "../../../../whatsapp/infra/database/repositories/drizzle-whatsapp-messages.repository.js";
import { WhatsAppAbsenceNotificationAdapter } from "../../../../whatsapp/infra/notifications/whatsapp-absence-notification.adapter.js";
import { DatafyWhatsAppAdapter } from "../../../../whatsapp/infra/whatsapp/datafy-whatsapp.adapter.js";
import { EvolutionWhatsAppAdapter } from "../../../../whatsapp/infra/whatsapp/evolution-whatsapp.adapter.js";
import { WhatsAppGatewayRouter } from "../../../../whatsapp/infra/whatsapp/whatsapp-gateway-router.js";
import { AppointmentsController } from "../controllers/appointments.controller.js";
import { ScheduleBlocksController } from "../controllers/schedule-blocks.controller.js";

class DrizzleOwnerAuthorizationVerifier implements OwnerAuthorizationVerifier {
  async verifyOwnerPassword(
    companyId: string,
    plainPassword: string,
  ): Promise<{ id: string; name: string } | null> {
    const [company] = await db
      .select({
        id: CompanyTable.id,
        name: CompanyTable.name,
        password: CompanyTable.password,
        isActive: CompanyTable.isActive,
      })
      .from(CompanyTable)
      .where(eq(CompanyTable.id, companyId))
      .limit(1);

    if (!company || !company.isActive) {
      return null;
    }

    const matches = await bcrypt.compare(plainPassword, company.password);
    return matches ? { id: company.id, name: company.name } : null;
  }
}

export interface AppointmentsDependencies {
  scheduleBlocksRepository?: ScheduleBlocksRepository;
  appointmentsRepository?: AppointmentsRepository;
  lookupRepository?: SchedulingContextLookupRepository;
  absenceNotificationPort?: AbsenceNotificationPort;
  ownerAuthorizationVerifier?: OwnerAuthorizationVerifier;
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
    deps.absenceNotificationPort ??
    new WhatsAppAbsenceNotificationAdapter(
      new WhatsAppGatewayRouter(
        new DrizzleCompanyWhatsAppConnectionRepository(),
        new EvolutionWhatsAppAdapter(),
        new DatafyWhatsAppAdapter(),
        new AesSecretCipher(),
      ),
      new DrizzleWhatsAppConversationsRepository(),
      new DrizzleWhatsAppMessagesRepository(),
      new DrizzleClientsRepository(),
    );
  const ownerAuthorizationVerifier =
    deps.ownerAuthorizationVerifier ?? new DrizzleOwnerAuthorizationVerifier();

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
    new RevertCompletedAppointmentUseCase(
      appointmentsRepository,
      ownerAuthorizationVerifier,
    ),
  );

  return { scheduleBlocksController, appointmentsController };
}
