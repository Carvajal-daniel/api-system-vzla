import type { FastifyReply, FastifyRequest } from "fastify";
import type { CreateAppointmentUseCase } from "../../../application/use-cases/create-appointment.use-case.js";
import type { GetAvailabilityUseCase } from "../../../application/use-cases/get-availability.use-case.js";
import type { ListAppointmentsUseCase } from "../../../application/use-cases/list-appointments.use-case.js";
import type { RescheduleAppointmentUseCase } from "../../../application/use-cases/reschedule-appointment.use-case.js";
import type { UpdateAppointmentStatusUseCase } from "../../../application/use-cases/update-appointment-status.use-case.js";
import {
  appointmentIdParamSchema,
  availabilityQuerySchema,
  companyIdParamSchema,
  createOwnerAppointmentBodySchema,
  createPublicAppointmentBodySchema,
  listAppointmentsQuerySchema,
  listOwnAppointmentsQuerySchema,
  rescheduleAppointmentBodySchema,
  updateAppointmentStatusBodySchema,
} from "../schemas/appointments-http.schemas.js";

export class AppointmentsController {
  constructor(
    private readonly getAvailabilityUseCase: GetAvailabilityUseCase,
    private readonly createAppointmentUseCase: CreateAppointmentUseCase,
    private readonly listAppointmentsUseCase: ListAppointmentsUseCase,
    private readonly updateAppointmentStatusUseCase: UpdateAppointmentStatusUseCase,
    private readonly rescheduleAppointmentUseCase: RescheduleAppointmentUseCase,
  ) {}

  async getPublicAvailability(request: FastifyRequest, reply: FastifyReply) {
    const { companyId } = companyIdParamSchema.parse(request.params);
    const query = availabilityQuerySchema.parse(request.query);

    const availability = await this.getAvailabilityUseCase.execute({
      companyId,
      serviceId: query.serviceId,
      date: query.date,
      collaboratorId: query.collaboratorId,
      timezone: query.timezone,
    });

    return reply.status(200).send(availability);
  }

  async createPublic(request: FastifyRequest, reply: FastifyReply) {
    const { companyId } = companyIdParamSchema.parse(request.params);
    const body = createPublicAppointmentBodySchema.parse(request.body);

    const appointment = await this.createAppointmentUseCase.executePublic({
      companyId,
      serviceId: body.serviceId,
      collaboratorId: body.collaboratorId,
      startsAt: body.startsAt,
      clientName: body.clientName,
      clientPhone: body.clientPhone,
    });

    return reply.status(201).send(appointment);
  }

  async createInternal(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const body = createOwnerAppointmentBodySchema.parse(request.body);

    const appointment = await this.createAppointmentUseCase.executeInternal({
      actor,
      serviceId: body.serviceId,
      collaboratorId: body.collaboratorId,
      startsAt: body.startsAt,
      clientName: body.clientName,
      clientPhone: body.clientPhone,
      initialStatus: body.initialStatus,
    });

    return reply.status(201).send(appointment);
  }

  async listForOwner(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const query = listAppointmentsQuerySchema.parse(request.query);
    const appointments = await this.listAppointmentsUseCase.execute({
      actor,
      collaboratorId: query.collaboratorId,
      from: query.from,
      to: query.to,
      status: query.status,
    });

    return reply.status(200).send(appointments);
  }

  async listForCollaborator(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const query = listOwnAppointmentsQuerySchema.parse(request.query);
    const appointments = await this.listAppointmentsUseCase.execute({
      actor,
      from: query.from,
      to: query.to,
      status: query.status,
    });

    return reply.status(200).send(appointments);
  }

  async updateStatus(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { appointmentId } = appointmentIdParamSchema.parse(request.params);
    const body = updateAppointmentStatusBodySchema.parse(request.body);

    const updated = await this.updateAppointmentStatusUseCase.execute({
      actor,
      appointmentId,
      status: body.status,
      cancellationReason: body.cancellationReason ?? null,
    });

    return reply.status(200).send(updated);
  }

  async reschedule(request: FastifyRequest, reply: FastifyReply) {
    const actor = request.actor;
    if (!actor) {
      return reply.status(401).send({ message: "Authentication required." });
    }

    const { appointmentId } = appointmentIdParamSchema.parse(request.params);
    const body = rescheduleAppointmentBodySchema.parse(request.body);

    const updated = await this.rescheduleAppointmentUseCase.execute({
      actor,
      appointmentId,
      startsAt: body.startsAt,
      collaboratorId: body.collaboratorId,
    });

    return reply.status(200).send(updated);
  }
}
