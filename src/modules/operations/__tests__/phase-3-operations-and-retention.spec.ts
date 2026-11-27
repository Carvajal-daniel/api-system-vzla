import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActorContext } from "../../../shared/auth/actor-context.js";
import { Appointment } from "../../appointments/domain/entities/appointment.entity.js";
import { UpdateAppointmentStatusUseCase } from "../../appointments/application/use-cases/update-appointment-status.use-case.js";
import { InMemoryAppointmentsRepository } from "../../appointments/application/__tests__/in-memory-appointments.repository.js";
import { CreateFinanceOrder } from "../../finance/application/orders.use-cases.js";
import type { FinanceOrderRecord, OrdersRepository } from "../../finance/domain/orders.js";
import {
  CascadeDelayUseCase,
  type CascadeDelayRepositoryPort,
  type ShiftedAppointmentRecord,
} from "../application/cascade-delay.use-case.js";
import {
  ChurnRadarUseCase,
  type ChurnRadarRepositoryPort,
} from "../application/churn-radar.use-case.js";
import {
  EmergencyAbsenceUseCase,
  type EmergencyAbsenceRepositoryPort,
} from "../application/emergency-absence.use-case.js";
import type {
  OperationsNotificationPort,
  OperationsWhatsAppDispatchInput,
} from "../application/ports/operations-notification.port.js";
import {
  PostVisitSurveyUseCase,
  type ActiveSentSurveyRecord,
  type DuePostVisitSurveyRecord,
  type PostVisitSurveyRepositoryPort,
} from "../application/post-visit-survey.use-case.js";
import {
  WaitlistUseCase,
  type WaitlistEntryRecord,
  type WaitlistRepositoryPort,
} from "../application/waitlist.use-case.js";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ACTOR: ActorContext = {
  role: "OWNER",
  companyId: COMPANY_ID,
  userId: COMPANY_ID,
};

function createSpyNotificationPort() {
  const sent: OperationsWhatsAppDispatchInput[] = [];
  const port: OperationsNotificationPort = {
    async sendOperationalMessage(input) {
      sent.push(input);
      return {
        delivered: true,
        provider: "MOCK_GATEWAY",
        externalMessageId: `msg-${sent.length}`,
      };
    },
  };
  return { port, sent };
}

describe("Phase 3 — Operação Inteligente de Balcão e Retenção Ativa", () => {
  it("1. Atraso em Cascata: desloca agendamentos futuros e notifica apenas os afetados via L0", async () => {
    const { port, sent } = createSpyNotificationPort();
    const collabId = randomUUID();
    const now = new Date("2026-11-27T13:00:00.000Z"); // 10:00 America/Sao_Paulo

    const stored: Array<{
      id: string;
      clientName: string;
      clientPhone: string;
      startsAt: Date;
      endsAt: Date;
      status: string;
    }> = [
      {
        id: randomUUID(),
        clientName: "Carlos Passado",
        clientPhone: "+5511999990001",
        startsAt: new Date("2026-11-27T12:00:00.000Z"), // já passou
        endsAt: new Date("2026-11-27T12:45:00.000Z"),
        status: "CONFIRMED",
      },
      {
        id: randomUUID(),
        clientName: "Bruno Futuro",
        clientPhone: "+5511999990002",
        startsAt: new Date("2026-11-27T14:00:00.000Z"), // 11:00 SP
        endsAt: new Date("2026-11-27T14:45:00.000Z"),
        status: "CONFIRMED",
      },
      {
        id: randomUUID(),
        clientName: "Diego Pendente",
        clientPhone: "+5511999990003",
        startsAt: new Date("2026-11-27T15:00:00.000Z"), // 12:00 SP
        endsAt: new Date("2026-11-27T15:30:00.000Z"),
        status: "PENDING",
      },
      {
        id: randomUUID(),
        clientName: "Eduardo Cancelado",
        clientPhone: "+5511999990004",
        startsAt: new Date("2026-11-27T16:00:00.000Z"),
        endsAt: new Date("2026-11-27T16:30:00.000Z"),
        status: "CANCELED",
      },
    ];

    const repo: CascadeDelayRepositoryPort = {
      async findCompanyAndCollaborator() {
        return { timezone: "America/Sao_Paulo", collaboratorName: "Barbeiro João" };
      },
      async shiftFutureAppointmentsInDay(params) {
        const offsetMs = params.delayMinutes * 60 * 1000;
        const shifted: ShiftedAppointmentRecord[] = [];
        for (const row of stored) {
          if (
            (row.status === "CONFIRMED" || row.status === "PENDING") &&
            row.startsAt >= params.windowStartUtc &&
            row.startsAt < params.windowEndUtc
          ) {
            const prevStarts = row.startsAt;
            const prevEnds = row.endsAt;
            row.startsAt = new Date(prevStarts.getTime() + offsetMs);
            row.endsAt = new Date(prevEnds.getTime() + offsetMs);
            shifted.push({
              id: row.id,
              clientName: row.clientName,
              clientPhone: row.clientPhone,
              previousStartsAt: prevStarts,
              previousEndsAt: prevEnds,
              newStartsAt: row.startsAt,
              newEndsAt: row.endsAt,
              status: row.status,
            });
          }
        }
        return shifted;
      },
    };

    const useCase = new CascadeDelayUseCase(repo, port);
    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      collaboratorId: collabId,
      date: "2026-11-27",
      delayMinutes: 30,
      now,
    });

    expect(result.affectedCount).toBe(2);
    expect(result.notifiedCount).toBe(2);
    expect(result.appointments[0]?.clientName).toBe("Bruno Futuro");
    expect(result.appointments[0]?.newStartsAt).toBe("2026-11-27T14:30:00.000Z");
    expect(result.appointments[1]?.clientName).toBe("Diego Pendente");
    expect(result.appointments[1]?.newStartsAt).toBe("2026-11-27T15:30:00.000Z");

    expect(sent).toHaveLength(2);
    expect(sent.every((m) => m.kind === "CASCADE_DELAY" && m.recordL0Telemetry === true)).toBe(true);
    expect(sent[0]?.text).toContain("30 minutos");
    expect(sent[0]?.text).toContain("Barbeiro João");
  });

  it("2. Modo Imprevisto: bloqueia agenda, sugere encaixe em outro barbeiro, notifica clientes e cria owner_alert", async () => {
    const { port, sent } = createSpyNotificationPort();
    const absentCollabId = randomUUID();
    const backupCollabId = randomUUID();
    const serviceId = randomUUID();
    const createdAlerts: Array<{ type: string; title: string; metadata: Record<string, unknown> }> = [];
    let createdBlock = false;

    const repo: EmergencyAbsenceRepositoryPort = {
      async findCompanyAndCollaborator() {
        return { timezone: "America/Sao_Paulo", collaboratorName: "Barbeiro Marcos" };
      },
      async createDayScheduleBlock() {
        createdBlock = true;
        return { id: "block-emergency-1" };
      },
      async findActiveAppointmentsForCollaboratorInRange() {
        return [
          {
            id: "appt-1",
            serviceId,
            serviceName: "Corte Degradê",
            clientName: "Rafael",
            clientPhone: "+5511988881111",
            startsAt: new Date("2026-11-27T14:00:00.000Z"),
            endsAt: new Date("2026-11-27T14:45:00.000Z"),
            status: "CONFIRMED",
          },
          {
            id: "appt-2",
            serviceId,
            serviceName: "Corte Degradê",
            clientName: "Lucas",
            clientPhone: "+5511988882222",
            startsAt: new Date("2026-11-27T18:00:00.000Z"),
            endsAt: new Date("2026-11-27T18:45:00.000Z"),
            status: "PENDING",
          },
        ];
      },
      async findCompatibleAlternativeSlot(params) {
        if (params.targetStartsAt.toISOString() === "2026-11-27T14:00:00.000Z") {
          return {
            collaboratorId: backupCollabId,
            collaboratorName: "Barbeiro Pedro",
            startsAt: new Date("2026-11-27T14:30:00.000Z"),
            endsAt: new Date("2026-11-27T15:15:00.000Z"),
          };
        }
        return null;
      },
      async createOwnerAlert(params) {
        createdAlerts.push(params);
        return { id: "alert-emergency-1" };
      },
    };

    const useCase = new EmergencyAbsenceUseCase(repo, port);
    const result = await useCase.execute({
      actor: OWNER_ACTOR,
      collaboratorId: absentCollabId,
      date: "2026-11-27",
      reason: "Emergência médica",
    });

    expect(createdBlock).toBe(true);
    expect(result.blockId).toBe("block-emergency-1");
    expect(result.ownerAlertId).toBe("alert-emergency-1");
    expect(result.affectedCount).toBe(2);
    expect(result.notifiedCount).toBe(2);
    expect(result.affectedAppointments[0]?.suggestedAlternative?.collaboratorName).toBe("Barbeiro Pedro");
    expect(result.affectedAppointments[1]?.suggestedAlternative).toBeNull();

    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toContain("Barbeiro Pedro");
    expect(sent[1]?.text).toContain("prioridade total");
    expect(createdAlerts).toHaveLength(1);
    expect(createdAlerts[0]?.type).toBe("COLLABORATOR_EMERGENCY");
  });

  it("3. Fila de Espera Inteligente: dispara oferta ao cancelar horário e passa ao próximo após janela de 20 min", async () => {
    const { port, sent } = createSpyNotificationPort();
    const collabId = randomUUID();
    const serviceId = randomUUID();
    const client1Id = randomUUID();
    const client2Id = randomUUID();

    const entries: WaitlistEntryRecord[] = [];

    const waitlistRepo: WaitlistRepositoryPort = {
      async getCompanyContext() {
        return { companyName: "Barbearia Prime", timezone: "America/Sao_Paulo" };
      },
      async clientExistsInCompany() {
        return true;
      },
      async collaboratorExistsInCompany(_cid, id) {
        return { id, name: "Barbeiro André" };
      },
      async createEntry(params) {
        const isFirst = entries.length === 0;
        const entry: WaitlistEntryRecord = {
          id: randomUUID(),
          companyId: params.companyId,
          clientId: params.clientId,
          clientName: isFirst ? "Cliente 1" : "Cliente 2",
          clientPhone: isFirst ? "+5511977770001" : "+5511977770002",
          collaboratorId: params.collaboratorId,
          collaboratorName: params.collaboratorId ? "Barbeiro André" : null,
          desiredDate: params.desiredDate,
          preferredShift: params.preferredShift,
          status: "WAITING",
          notifiedAt: null,
          expiresAt: null,
          createdAt: new Date(Date.now() + entries.length * 1000),
        };
        entries.push(entry);
        return entry;
      },
      async listEntries(params) {
        return entries.filter(
          (e) =>
            e.companyId === params.companyId &&
            e.desiredDate === params.date &&
            (!params.status || e.status === params.status),
        );
      },
      async findWaitingCandidatesForDate(params) {
        return entries.filter(
          (e) =>
            e.companyId === params.companyId &&
            e.desiredDate === params.desiredDate &&
            e.status === "WAITING" &&
            (!params.collaboratorId ||
              e.collaboratorId === null ||
              e.collaboratorId === params.collaboratorId),
        );
      },
      async markEntryNotified(params) {
        const entry = entries.find(
          (e) => e.id === params.entryId && e.status === "WAITING",
        );
        if (!entry) return null;
        entry.status = "NOTIFIED";
        entry.notifiedAt = params.notifiedAt;
        entry.expiresAt = params.expiresAt;
        return { ...entry };
      },
      async expireStaleNotifiedEntries(now) {
        const expired: WaitlistEntryRecord[] = [];
        for (const entry of entries) {
          if (entry.status === "NOTIFIED" && entry.expiresAt && entry.expiresAt <= now) {
            entry.status = "EXPIRED";
            expired.push({ ...entry });
          }
        }
        return expired;
      },
    };

    const waitlistUseCase = new WaitlistUseCase(waitlistRepo, port);

    await waitlistUseCase.addEntry({
      actor: OWNER_ACTOR,
      clientId: client1Id,
      collaboratorId: collabId,
      desiredDate: "2026-11-28",
      preferredShift: "AFTERNOON",
    });
    await waitlistUseCase.addEntry({
      actor: OWNER_ACTOR,
      clientId: client2Id,
      collaboratorId: null,
      desiredDate: "2026-11-28",
      preferredShift: "ANY",
    });

    // Cancela um agendamento da tarde (14:00 SP = 17:00 UTC) e verifica gatilho automático.
    const appointmentsRepo = new InMemoryAppointmentsRepository();
    const appt = Appointment.create({
      companyId: COMPANY_ID,
      collaboratorId: collabId,
      serviceId,
      clientName: "Cliente Que Cancelou",
      clientPhone: "+5511966660000",
      startsAt: new Date("2026-11-28T17:00:00.000Z"),
      initialStatus: "CONFIRMED",
      serviceNameSnapshot: "Corte",
      servicePriceInCentsSnapshot: 5000,
      serviceDurationMinutesSnapshot: 30,
      commissionPercentageSnapshot: 50,
    });
    await appointmentsRepo.createWithLock(appt);

    const cancelNow = new Date("2026-11-28T12:00:00.000Z");
    const updateStatusUseCase = new UpdateAppointmentStatusUseCase(
      appointmentsRepo,
      waitlistUseCase,
    );

    await updateStatusUseCase.execute({
      actor: OWNER_ACTOR,
      appointmentId: appt.id,
      status: "CANCELED",
      cancellationReason: "Imprevisto do cliente",
      now: cancelNow,
    });

    expect(entries[0]?.status).toBe("NOTIFIED");
    expect(entries[0]?.expiresAt?.toISOString()).toBe("2026-11-28T12:20:00.000Z");
    expect(entries[1]?.status).toBe("WAITING");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.contactName).toBe("Cliente 1");
    expect(sent[0]?.text).toContain("20 minutos");

    // Após 21 minutos sem aceite, expira Cliente 1 e oferta automaticamente ao Cliente 2.
    const after21Min = new Date("2026-11-28T12:21:00.000Z");
    const expiryResult = await waitlistUseCase.expireStaleOffersAndNotifyNext(after21Min);

    expect(expiryResult.expiredCount).toBe(1);
    expect(expiryResult.reofferedCount).toBe(1);
    expect(entries[0]?.status).toBe("EXPIRED");
    expect(entries[1]?.status).toBe("NOTIFIED");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.contactName).toBe("Cliente 2");
  });

  it("4. Blindagem de Reputação (L0): fecha comanda -> agenda 2h -> nota 5 envia Google Review vs nota 2 escala ao dono", async () => {
    const { port, sent } = createSpyNotificationPort();
    const googleUrl = "https://g.page/r/barbearia-prime/review";
    const ownerAlerts: Array<{ type: string; title: string; metadata: Record<string, unknown> }> = [];

    const surveys: Array<{
      id: string;
      companyId: string;
      appointmentId: string;
      clientId: string;
      clientName: string;
      clientPhone: string;
      status: "PENDING_SEND" | "SENT" | "ANSWERED" | "ESCALATED_TO_OWNER";
      score: number | null;
      feedbackText: string | null;
      scheduledFor: Date;
      sentAt: Date | null;
      answeredAt: Date | null;
    }> = [];

    const surveyRepo: PostVisitSurveyRepositoryPort = {
      async scheduleSurveyForClosedOrder(params) {
        const id = randomUUID();
        surveys.push({
          id,
          companyId: params.companyId,
          appointmentId: params.appointmentId,
          clientId: randomUUID(),
          clientName: params.clientName ?? "Cliente",
          clientPhone: params.clientPhone ?? "+5511955550000",
          status: "PENDING_SEND",
          score: null,
          feedbackText: null,
          scheduledFor: params.scheduledFor,
          sentAt: null,
          answeredAt: null,
        });
        return { scheduled: true, surveyId: id };
      },
      async findDuePendingSurveys(now): Promise<DuePostVisitSurveyRecord[]> {
        return surveys
          .filter((s) => s.status === "PENDING_SEND" && s.scheduledFor <= now)
          .map((s) => ({
            id: s.id,
            companyId: s.companyId,
            companyName: "Barbearia Prime",
            appointmentId: s.appointmentId,
            clientId: s.clientId,
            clientName: s.clientName,
            clientPhone: s.clientPhone,
            serviceName: "Corte + Barba",
            collaboratorName: "Barbeiro Leo",
            scheduledFor: s.scheduledFor,
          }));
      },
      async markSurveySent(params) {
        const survey = surveys.find((s) => s.id === params.surveyId && s.status === "PENDING_SEND");
        if (!survey) return false;
        survey.status = "SENT";
        survey.sentAt = params.sentAt;
        return true;
      },
      async findRecentSentSurveyByPhone(params): Promise<ActiveSentSurveyRecord | null> {
        const found = surveys.find(
          (s) =>
            s.companyId === params.companyId &&
            s.status === "SENT" &&
            s.sentAt &&
            s.sentAt >= params.since &&
            s.clientPhone === params.phone,
        );
        if (!found || !found.sentAt) return null;
        return {
          id: found.id,
          companyId: found.companyId,
          companyName: "Barbearia Prime",
          googleReviewUrl: googleUrl,
          appointmentId: found.appointmentId,
          collaboratorId: randomUUID(),
          collaboratorName: "Barbeiro Leo",
          serviceName: "Corte + Barba",
          clientId: found.clientId,
          clientName: found.clientName,
          clientPhone: found.clientPhone,
          sentAt: found.sentAt,
        };
      },
      async recordSurveyAnswer(params) {
        const found = surveys.find((s) => s.id === params.surveyId && s.status === "SENT");
        if (!found) return false;
        found.score = params.score;
        found.feedbackText = params.feedbackText;
        found.status = params.status;
        found.answeredAt = params.answeredAt;
        return true;
      },
      async createOwnerAlert(params) {
        ownerAlerts.push(params);
        return { id: `alert-${ownerAlerts.length}` };
      },
    };

    const surveyUseCase = new PostVisitSurveyUseCase(surveyRepo, port);

    // Simula fechamento de duas comandas (CreateFinanceOrder -> CLOSED)
    const fakeOrdersRepo: Partial<OrdersRepository> = {
      async createOrder(_companyId, draft): Promise<FinanceOrderRecord> {
        return {
          id: randomUUID(),
          companyId: COMPANY_ID,
          code: draft.code,
          appointmentId: draft.appointmentId,
          clientName: draft.clientName,
          clientPhone: draft.clientPhone,
          clientDocument: draft.clientDocument,
          orderDate: draft.orderDate,
          status: draft.status,
          subtotalCents: draft.subtotalCents,
          discountCents: draft.discountCents,
          totalCents: draft.totalCents,
          paidCents: draft.paidCents,
          openInCents: Math.max(0, draft.totalCents - draft.paidCents),
          notes: draft.notes,
          createdAt: new Date().toISOString(),
          items: [],
          payments: [],
        };
      },
    };

    const createOrder = new CreateFinanceOrder(
      fakeOrdersRepo as OrdersRepository,
      surveyUseCase,
    );

    await createOrder.execute(OWNER_ACTOR, {
      appointmentId: randomUUID(),
      clientName: "Cliente Feliz",
      clientPhone: "+5511944440001",
      orderDate: "2026-11-27",
      status: "CLOSED",
      discountCents: 0,
      requestKey: randomUUID(),
      items: [
        {
          itemType: "SERVICE",
          name: "Corte + Barba",
          quantity: 1,
          unitPriceCents: 8000,
          commissionPercentage: 50,
        },
      ],
      payments: [{ method: "PIX", amountCents: 8000 }],
    });

    await createOrder.execute(OWNER_ACTOR, {
      appointmentId: randomUUID(),
      clientName: "Cliente Insatisfeito",
      clientPhone: "+5511944440002",
      orderDate: "2026-11-27",
      status: "CLOSED",
      discountCents: 0,
      requestKey: randomUUID(),
      items: [
        {
          itemType: "SERVICE",
          name: "Corte + Barba",
          quantity: 1,
          unitPriceCents: 8000,
          commissionPercentage: 50,
        },
      ],
      payments: [{ method: "PIX", amountCents: 8000 }],
    });

    expect(surveys).toHaveLength(2);
    expect(surveys.every((s) => s.status === "PENDING_SEND")).toBe(true);

    // 2h depois, despacha pesquisas pendentes
    const twoHoursLater = new Date(Date.now() + 2 * 60 * 60 * 1000 + 60_000);
    const dispatchResult = await surveyUseCase.dispatchDueSurveys(twoHoursLater);
    expect(dispatchResult.sentCount).toBe(2);

    // Resposta L0 Nota 5 -> envia Google Review e NÃO gera alerta ao dono
    const reply5 = await surveyUseCase.tryHandleInboundL0Reply({
      companyId: COMPANY_ID,
      phone: "+5511944440001",
      content: "5",
      now: new Date(twoHoursLater.getTime() + 10 * 60 * 1000),
    });
    expect(reply5.handled).toBe(true);
    expect(reply5.status).toBe("ANSWERED");
    expect(reply5.replyText).toContain(googleUrl);
    expect(reply5.ownerAlertId).toBeUndefined();
    expect(ownerAlerts).toHaveLength(0);

    // Resposta L0 Nota 2 -> NÃO envia Google Review, marca ESCALATED_TO_OWNER e cria owner_alert LOW_SURVEY_SCORE
    const reply2 = await surveyUseCase.tryHandleInboundL0Reply({
      companyId: COMPANY_ID,
      phone: "+5511944440002",
      content: "2 - demorou muito para atender",
      now: new Date(twoHoursLater.getTime() + 15 * 60 * 1000),
    });
    expect(reply2.handled).toBe(true);
    expect(reply2.status).toBe("ESCALATED_TO_OWNER");
    expect(reply2.replyText).not.toContain(googleUrl);
    expect(reply2.ownerAlertId).toBe("alert-1");
    expect(ownerAlerts).toHaveLength(1);
    expect(ownerAlerts[0]?.type).toBe("LOW_SURVEY_SCORE");
    expect(surveys[1]?.status).toBe("ESCALATED_TO_OWNER");
    expect(surveys[1]?.score).toBe(2);
    expect(surveys[1]?.feedbackText).toBe("demorou muito para atender");
    expect(sent.every((m) => m.recordL0Telemetry === true)).toBe(true);
  });

  it("5. Radar de Churn Individual: calcula ciclo médio real (>=2 visitas), classifica WARNING/HIGH_RISK e dispara reativação", async () => {
    const { port, sent } = createSpyNotificationPort();
    const now = new Date("2026-11-27T15:00:00.000Z");
    const day = (daysAgo: number) =>
      new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    const highRiskClientId = randomUUID();
    const warningClientId = randomUUID();
    const healthyClientId = randomUUID();
    const singleVisitClientId = randomUUID();

    const churnRepo: ChurnRadarRepositoryPort = {
      async getCompanyName() {
        return "Barbearia Prime";
      },
      async listCompletedVisitHistories() {
        return [
          {
            // Ciclo real de 14 dias; última visita há 26 dias -> atraso de 12 dias -> HIGH_RISK
            clientId: highRiskClientId,
            clientName: "João Quinzenal",
            clientPhone: "+5511933330001",
            lastServiceName: "Corte Degradê",
            lastCollaboratorName: "Barbeiro Leo",
            completedVisitDates: [day(54), day(40), day(26)],
          },
          {
            // Ciclo real de 20 dias; última visita há 25 dias -> atraso de 5 dias -> WARNING
            clientId: warningClientId,
            clientName: "Pedro Regular",
            clientPhone: "+5511933330002",
            lastServiceName: "Barba",
            lastCollaboratorName: "Barbeiro Leo",
            completedVisitDates: [day(65), day(45), day(25)],
          },
          {
            // Ciclo real de 30 dias; última visita há 22 dias -> dentro do ciclo (não entra)
            clientId: healthyClientId,
            clientName: "Mateus Em Dia",
            clientPhone: "+5511933330003",
            lastServiceName: "Corte",
            lastCollaboratorName: "Barbeiro Leo",
            completedVisitDates: [day(52), day(22)],
          },
          {
            // Apenas 1 visita concluída -> ignorado pelo requisito mínimo de 2 visitas
            clientId: singleVisitClientId,
            clientName: "Novo Cliente",
            clientPhone: "+5511933330004",
            lastServiceName: "Corte",
            lastCollaboratorName: "Barbeiro Leo",
            completedVisitDates: [day(45)],
          },
        ];
      },
    };

    const useCase = new ChurnRadarUseCase(churnRepo, port);
    const radar = await useCase.getRadar({
      actor: OWNER_ACTOR,
      marginDays: 4,
      now,
    });

    expect(radar.totalAtRisk).toBe(2);
    expect(radar.highRiskCount).toBe(1);
    expect(radar.warningCount).toBe(1);
    expect(radar.clients[0]?.clientId).toBe(highRiskClientId);
    expect(radar.clients[0]?.averageCycleDays).toBe(14);
    expect(radar.clients[0]?.overdueDays).toBe(12);
    expect(radar.clients[0]?.risk).toBe("HIGH_RISK");
    expect(radar.clients[1]?.clientId).toBe(warningClientId);
    expect(radar.clients[1]?.averageCycleDays).toBe(20);
    expect(radar.clients[1]?.overdueDays).toBe(5);
    expect(radar.clients[1]?.risk).toBe("WARNING");

    // Dispara convite personalizado de reativação
    const invite = await useCase.sendReactivationInvite({
      actor: OWNER_ACTOR,
      clientId: highRiskClientId,
      now,
    });

    expect(invite.delivered).toBe(true);
    expect(invite.message).toContain("João Quinzenal");
    expect(invite.message).toContain("14 dias");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.kind).toBe("CHURN_REACTIVATION");
    expect(sent[0]?.recordL0Telemetry).toBe(true);
    expect(vi.isMockFunction).toBeDefined();
  });
});
