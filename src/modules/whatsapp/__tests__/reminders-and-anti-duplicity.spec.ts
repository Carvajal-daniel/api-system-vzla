import { describe, expect, it, vi } from "vitest";
import { ProcessAppointmentRemindersUseCase } from "../application/use-cases/process-appointment-reminders.use-case.js";
import { buildAiBookingSystemPrompt } from "../infra/ai/ai-booking-tool-definitions.js";

describe("WhatsApp AI future appointments & automatic reminders worker", () => {
  it("injects upcoming future appointments and anti-duplicity / reminder guidance into AI prompt", () => {
    const prompt = buildAiBookingSystemPrompt({
      company: {
        companyId: "comp-1",
        companyName: "Barbearia Central",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: null,
        services: [{ id: "svc-1", name: "Corte Degradê", durationMinutes: 30, priceInCents: 4500 }],
        collaborators: [{ id: "col-1", name: "Lucas", specialty: "Corte", serviceIds: ["svc-1"] }],
        customerContext: {
          registeredName: "Marcos",
          isNewCustomer: false,
          upcomingAppointments: [
            {
              appointmentId: "appt-123",
              serviceName: "Corte Degradê",
              collaboratorName: "Lucas",
              localDate: "2026-12-01",
              localTime: "17:00",
              startsAt: "2026-12-01T20:00:00.000Z",
              status: "CONFIRMED",
            },
          ],
        },
      },
      client: { id: "cli-1", name: "Marcos", phone: "+5511999991111" },
      history: [],
      latestClientMessage: "Pode me lembrar meu horário?",
      now: new Date("2026-11-27T12:00:00Z"),
      tools: {} as never,
    });

    expect(prompt).toContain("Agendamentos futuros ativos do cliente:");
    expect(prompt).toContain("[id: appt-123] 2026-12-01 às 17:00 — Corte Degradê com Lucas (status: CONFIRMED)");
    expect(prompt).toContain("ANTI-DUPLICIDADE");
    expect(prompt).toContain("Pode me lembrar?");
  });

  it("skips disconnected WhatsApp tenants without claiming reminder and renders custom template for connected tenants", async () => {
    const markReminderSent = vi.fn().mockResolvedValue(true);
    const sendText = vi.fn().mockResolvedValue({ externalMessageId: "wamid-01" });
    const upsertOutbound = vi.fn().mockResolvedValue({ id: "conv-1" });
    const createIdempotent = vi.fn().mockResolvedValue(undefined);
    const recordAiUsage = vi.fn().mockResolvedValue(undefined);

    const remindersRepo = {
      findPendingReminders: vi.fn().mockImplementation(async ({ windowType }) => {
        if (windowType !== "2H") return [];
        return [
          {
            appointmentId: "appt-disconnected",
            companyId: "tenant-off",
            companyName: "Barbearia Off",
            companyTimezone: "America/Sao_Paulo",
            clientName: "João",
            clientPhone: "+5511988887777",
            serviceName: "Corte",
            collaboratorName: "Pedro",
            startsAt: new Date("2026-11-27T17:00:00Z"),
          },
          {
            appointmentId: "appt-connected",
            companyId: "tenant-on",
            companyName: "Barbearia On",
            companySlug: "barbearia-on",
            companyTimezone: "America/Sao_Paulo",
            clientName: "Rafael",
            clientPhone: "+5511977776666",
            serviceName: "Barba",
            collaboratorName: "Diego",
            startsAt: new Date("2026-11-27T17:00:00Z"),
            reminderSettings: {
              enabled: true,
              hours: 2,
              template: "custom" as const,
              message: "Fala {nome}! Te esperamos em {empresa} às {hora} para {servico} com {profissional}.",
            },
          },
        ];
      }),
      markReminderSent,
    };

    const useCase = new ProcessAppointmentRemindersUseCase(
      remindersRepo,
      { upsertOutbound } as never,
      { createIdempotent } as never,
      { sendText } as never,
      {
        checkCanSendOutbound: vi.fn().mockResolvedValue({ allowed: true }),
        recordAiUsage,
      } as never,
      async (companyId) => companyId === "tenant-on",
      { info: vi.fn(), warn: vi.fn() },
    );

    const result = await useCase.execute({ now: new Date("2026-11-27T15:00:00Z") });

    expect(result).toEqual({
      sentCount: 1,
      skippedQuotaCount: 0,
      skippedAlreadySentCount: 0,
      skippedDisconnectedCount: 1,
      failedCount: 0,
    });
    expect(markReminderSent).toHaveBeenCalledTimes(1);
    expect(markReminderSent).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "tenant-on", appointmentId: "appt-connected" }),
    );
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-on",
        text: "Fala Rafael! Te esperamos em Barbearia On às 14:00 para Barba com Diego.",
      }),
    );
    expect(createIdempotent).toHaveBeenCalledTimes(1);
  });
});
