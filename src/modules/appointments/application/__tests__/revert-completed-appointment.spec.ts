import { describe, expect, it } from "vitest";
import { Appointment } from "../../domain/entities/appointment.entity.js";
import {
  AppointmentRevertNotAllowedError,
  InvalidOwnerAuthorizationError,
  RevertReasonRequiredError,
  UnauthorizedSchedulingActionError,
} from "../../domain/errors/appointment-errors.js";
import {
  type OwnerAuthorizationVerifier,
  RevertCompletedAppointmentUseCase,
} from "../use-cases/revert-completed-appointment.use-case.js";
import { InMemoryAppointmentsRepository } from "./in-memory-appointments.repository.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const COLLAB_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";

function makeCompletedAppointment() {
  const appt = Appointment.create({
    companyId: COMPANY_ID,
    collaboratorId: COLLAB_ID,
    serviceId: SERVICE_ID,
    clientName: "Carlos Silva",
    clientPhone: "+5511999990000",
    startsAt: new Date("2026-11-20T14:00:00.000Z"),
    initialStatus: "CONFIRMED",
    serviceNameSnapshot: "Corte Masculino",
    servicePriceInCentsSnapshot: 6000,
    serviceDurationMinutesSnapshot: 30,
    commissionPercentageSnapshot: 50,
  });
  appt.transitionStatus("COMPLETED");
  return appt;
}

describe("RevertCompletedAppointmentUseCase", () => {
  const verifier: OwnerAuthorizationVerifier = {
    async verifyOwnerPassword(companyId, plainPassword) {
      if (companyId === COMPANY_ID && plainPassword === "secret-owner") {
        return { id: COMPANY_ID, name: "Dono Teste" };
      }
      return null;
    },
  };

  it("reverts a COMPLETED appointment to CONFIRMED and records an audit log with valid OWNER credentials", async () => {
    const repo = new InMemoryAppointmentsRepository();
    const appt = makeCompletedAppointment();
    repo.items.push(appt);

    const useCase = new RevertCompletedAppointmentUseCase(repo, verifier);
    const result = await useCase.execute({
      actor: { role: "OWNER", userId: COMPANY_ID, companyId: COMPANY_ID },
      appointmentId: appt.id,
      reason: "Concluído por engano antes do cliente chegar",
      ownerPassword: "secret-owner",
    });

    expect(result.appointment.status).toBe("CONFIRMED");
    expect(result.auditLog.action).toBe("REVERT_COMPLETION");
    expect(result.auditLog.previousStatus).toBe("COMPLETED");
    expect(result.auditLog.newStatus).toBe("CONFIRMED");
    expect(result.auditLog.reason).toBe("Concluído por engano antes do cliente chegar");
    expect(result.auditLog.authorizedByName).toBe("Dono Teste");

    const logs = await repo.listAuditLogs(COMPANY_ID, appt.id);
    expect(logs).toHaveLength(1);
  });

  it("rejects COLLABORATOR role", async () => {
    const repo = new InMemoryAppointmentsRepository();
    const appt = makeCompletedAppointment();
    repo.items.push(appt);

    const useCase = new RevertCompletedAppointmentUseCase(repo, verifier);
    await expect(
      useCase.execute({
        actor: { role: "COLLABORATOR", collaboratorId: COLLAB_ID, companyId: COMPANY_ID },
        appointmentId: appt.id,
        reason: "Motivo válido",
        ownerPassword: "secret-owner",
      }),
    ).rejects.toThrow(UnauthorizedSchedulingActionError);
  });

  it("rejects invalid owner password", async () => {
    const repo = new InMemoryAppointmentsRepository();
    const appt = makeCompletedAppointment();
    repo.items.push(appt);

    const useCase = new RevertCompletedAppointmentUseCase(repo, verifier);
    await expect(
      useCase.execute({
        actor: { role: "OWNER", userId: COMPANY_ID, companyId: COMPANY_ID },
        appointmentId: appt.id,
        reason: "Motivo válido",
        ownerPassword: "wrong-password",
      }),
    ).rejects.toThrow(InvalidOwnerAuthorizationError);
  });

  it("rejects short or empty justification reason", async () => {
    const repo = new InMemoryAppointmentsRepository();
    const appt = makeCompletedAppointment();
    repo.items.push(appt);

    const useCase = new RevertCompletedAppointmentUseCase(repo, verifier);
    await expect(
      useCase.execute({
        actor: { role: "OWNER", userId: COMPANY_ID, companyId: COMPANY_ID },
        appointmentId: appt.id,
        reason: "erro",
        ownerPassword: "secret-owner",
      }),
    ).rejects.toThrow(RevertReasonRequiredError);
  });

  it("rejects appointments that are not COMPLETED", async () => {
    const repo = new InMemoryAppointmentsRepository();
    const appt = Appointment.create({
      companyId: COMPANY_ID,
      collaboratorId: COLLAB_ID,
      serviceId: SERVICE_ID,
      clientName: "Carlos Silva",
      clientPhone: "+5511999990000",
      startsAt: new Date("2026-11-20T14:00:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 6000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 50,
    });
    repo.items.push(appt);

    const useCase = new RevertCompletedAppointmentUseCase(repo, verifier);
    await expect(
      useCase.execute({
        actor: { role: "OWNER", userId: COMPANY_ID, companyId: COMPANY_ID },
        appointmentId: appt.id,
        reason: "Tentativa indevida",
        ownerPassword: "secret-owner",
      }),
    ).rejects.toThrow(AppointmentRevertNotAllowedError);
  });
});
