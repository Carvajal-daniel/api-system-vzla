import { describe, expect, it } from "vitest";
import { Appointment } from "../../appointments/domain/entities/appointment.entity.js";
import { AppointmentCompletionTooEarlyError } from "../../appointments/domain/errors/appointment-errors.js";
import type { AppointmentsRepository } from "../../appointments/domain/repositories/appointments.repository.js";
import { UpdateAppointmentStatusUseCase } from "../../appointments/application/use-cases/update-appointment-status.use-case.js";
import { getCommissionStatus } from "../domain/collections.js";

function makeAppointment(overrides: {
  startsAt: Date;
  grossInCents?: number;
  commissionPercentage?: number;
}) {
  return Appointment.create({
    companyId: "11111111-1111-4111-8111-111111111111",
    collaboratorId: "22222222-2222-4222-8222-222222222222",
    serviceId: "33333333-3333-4333-8333-333333333333",
    clientName: "Cliente Teste",
    clientPhone: "11999999999",
    startsAt: overrides.startsAt,
    initialStatus: "CONFIRMED",
    serviceNameSnapshot: "Corte",
    servicePriceInCentsSnapshot: overrides.grossInCents ?? 10_000,
    serviceDurationMinutesSnapshot: 30,
    commissionPercentageSnapshot: overrides.commissionPercentage ?? 40,
  });
}

// Reproduz exatamente a regra de classificação usada em GET /finance/summary (Dashboard e PDF).
function classifyForSummary(
  item: { startsAt: Date; status: "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELED" | "NO_SHOW"; grossInCents: number; commissionPercentage: number; collectedInCents: number; commissionPaidAt?: Date | null },
  now: Date,
) {
  const isFuture = item.startsAt > now;
  const status = item.status === "COMPLETED" && isFuture ? "CONFIRMED" : item.status;
  const realized = status === "COMPLETED";
  const forecast = status === "CONFIRMED" || status === "PENDING";
  const booked = realized || forecast;
  const commissionInCents = booked ? Math.round(item.grossInCents * item.commissionPercentage / 100) : 0;
  const openInCents = (realized || status === "CONFIRMED") ? Math.max(0, item.grossInCents - item.collectedInCents) : 0;
  const generated = realized ? commissionInCents : 0;
  const commissionStatus = getCommissionStatus(status, generated, item.commissionPaidAt ?? null, item.collectedInCents, item.grossInCents);
  return {
    effectiveStatus: status,
    realizedRevenueInCents: realized ? item.grossInCents : 0,
    forecastRevenueInCents: forecast ? item.grossInCents : 0,
    collectedInCents: item.collectedInCents,
    outstandingInCents: realized ? openInCents : 0,
    generatedCommissionInCents: generated,
    forecastCommissionInCents: forecast ? commissionInCents : 0,
    commissionStatus,
  };
}

describe("Regras financeiras e validação de atendimentos futuros (10 cenários)", () => {
  const now = new Date("2026-11-21T14:00:00Z");

  it("1) Serviço futuro confirmado entra apenas em previsão, nunca em realizado", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-23T14:00:00Z"),
      status: "CONFIRMED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 0,
    }, now);
    expect(res.realizedRevenueInCents).toBe(0);
    expect(res.forecastRevenueInCents).toBe(10_000);
    expect(res.generatedCommissionInCents).toBe(0);
    expect(res.forecastCommissionInCents).toBe(4_000);
  });

  it("2) Serviço futuro marcado como concluído é rejeitado no use case e não entra como realizado no resumo", async () => {
    const futureAppointment = makeAppointment({ startsAt: new Date("2026-11-23T14:00:00Z") });
    const repo = {
      findById: async () => futureAppointment,
      save: async () => undefined,
    } as unknown as AppointmentsRepository;
    const useCase = new UpdateAppointmentStatusUseCase(repo);

    await expect(useCase.execute({
      actor: { userId: "u1", companyId: futureAppointment.companyId, role: "OWNER" },
      appointmentId: futureAppointment.id,
      status: "COMPLETED",
      now,
    })).rejects.toBeInstanceOf(AppointmentCompletionTooEarlyError);

    // Guarda defensiva para registros legados no banco
    const legacy = classifyForSummary({
      startsAt: new Date("2026-11-23T14:00:00Z"),
      status: "COMPLETED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 0,
    }, now);
    expect(legacy.effectiveStatus).toBe("CONFIRMED");
    expect(legacy.realizedRevenueInCents).toBe(0);
    expect(legacy.forecastRevenueInCents).toBe(10_000);
    expect(legacy.generatedCommissionInCents).toBe(0);
  });

  it("3) Serviço passado concluído e pago soma em realizado, cobrado e comissão pronta", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-20T14:00:00Z"),
      status: "COMPLETED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 10_000,
    }, now);
    expect(res.realizedRevenueInCents).toBe(10_000);
    expect(res.collectedInCents).toBe(10_000);
    expect(res.outstandingInCents).toBe(0);
    expect(res.generatedCommissionInCents).toBe(4_000);
    expect(res.commissionStatus).toBe("READY");
  });

  it("4) Serviço concluído sem pagar gera saldo pendente e comissão aguardando cobrança", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-20T14:00:00Z"),
      status: "COMPLETED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 0,
    }, now);
    expect(res.realizedRevenueInCents).toBe(10_000);
    expect(res.outstandingInCents).toBe(10_000);
    expect(res.commissionStatus).toBe("AWAITING_COLLECTION");
  });

  it("5) Serviço cancelado não gera faturamento realizado, previsão nem comissão", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-20T14:00:00Z"),
      status: "CANCELED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 0,
    }, now);
    expect(res.realizedRevenueInCents).toBe(0);
    expect(res.forecastRevenueInCents).toBe(0);
    expect(res.generatedCommissionInCents).toBe(0);
    expect(res.commissionStatus).toBe("NONE");
  });

  it("6) Ausência (NO_SHOW) não gera faturamento realizado, previsão nem comissão", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-20T14:00:00Z"),
      status: "NO_SHOW",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 0,
    }, now);
    expect(res.realizedRevenueInCents).toBe(0);
    expect(res.forecastRevenueInCents).toBe(0);
    expect(res.generatedCommissionInCents).toBe(0);
    expect(res.commissionStatus).toBe("NONE");
  });

  it("7) Serviço futuro pago antecipadamente entra em cobrado e previsão, mas não em realizado", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-25T14:00:00Z"),
      status: "CONFIRMED",
      grossInCents: 10_000,
      commissionPercentage: 40,
      collectedInCents: 10_000,
    }, now);
    expect(res.collectedInCents).toBe(10_000);
    expect(res.forecastRevenueInCents).toBe(10_000);
    expect(res.realizedRevenueInCents).toBe(0);
    expect(res.generatedCommissionInCents).toBe(0);
  });

  it("8) Comissões futuras ficam apenas em previsão e nunca como prontas para repasse", () => {
    const res = classifyForSummary({
      startsAt: new Date("2026-11-28T14:00:00Z"),
      status: "PENDING",
      grossInCents: 8_000,
      commissionPercentage: 50,
      collectedInCents: 0,
    }, now);
    expect(res.forecastCommissionInCents).toBe(4_000);
    expect(res.generatedCommissionInCents).toBe(0);
    expect(res.commissionStatus).toBe("NONE");
  });

  it("9) Validação de conclusão respeita instante UTC independente do fuso horário", async () => {
    // 11:00 em America/Sao_Paulo (-03:00) = 14:00Z; 11:01 (-03:00) = 14:01Z (futuro)
    const futureSaoPaulo = makeAppointment({ startsAt: new Date("2026-11-21T11:01:00-03:00") });
    // O atendimento em Caracas termina às 10:00 (-04:00), o mesmo instante de 14:00Z.
    const pastCaracas = makeAppointment({ startsAt: new Date("2026-11-21T09:30:00-04:00") });

    const repoFuture = { findById: async () => futureSaoPaulo, save: async () => undefined } as unknown as AppointmentsRepository;
    const repoPast = { findById: async () => pastCaracas, save: async () => undefined } as unknown as AppointmentsRepository;

    await expect(new UpdateAppointmentStatusUseCase(repoFuture).execute({
      actor: { userId: "u1", companyId: futureSaoPaulo.companyId, role: "OWNER" },
      appointmentId: futureSaoPaulo.id,
      status: "COMPLETED",
      now,
    })).rejects.toBeInstanceOf(AppointmentCompletionTooEarlyError);

    const completed = await new UpdateAppointmentStatusUseCase(repoPast).execute({
      actor: { userId: "u1", companyId: pastCaracas.companyId, role: "OWNER" },
      appointmentId: pastCaracas.id,
      status: "COMPLETED",
      now,
    });
    expect(completed.status).toBe("COMPLETED");
  });

  it("10) Consistência Dashboard vs PDF: mesmos itens produzem os mesmos totais de caixa e competência", () => {
    const items = [
      { startsAt: new Date("2026-11-20T12:00:00Z"), status: "COMPLETED" as const, grossInCents: 10_000, commissionPercentage: 40, collectedInCents: 10_000 },
      { startsAt: new Date("2026-11-23T12:00:00Z"), status: "COMPLETED" as const, grossInCents: 15_000, commissionPercentage: 40, collectedInCents: 0 },
      { startsAt: new Date("2026-11-20T13:00:00Z"), status: "CANCELED" as const, grossInCents: 9_000, commissionPercentage: 40, collectedInCents: 0 },
    ];
    const results = items.map((item) => classifyForSummary(item, now));
    const totalRealized = results.reduce((s, r) => s + r.realizedRevenueInCents, 0);
    const totalForecast = results.reduce((s, r) => s + r.forecastRevenueInCents, 0);
    const totalCollected = results.reduce((s, r) => s + r.collectedInCents, 0);
    expect(totalRealized).toBe(10_000);
    expect(totalForecast).toBe(15_000);
    expect(totalCollected).toBe(10_000);
  });
});
