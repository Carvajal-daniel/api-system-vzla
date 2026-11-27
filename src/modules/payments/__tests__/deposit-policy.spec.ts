import { describe, expect, it } from "vitest";
import {
  evaluateDepositPolicy,
  evaluateSubscriptionRenewalAlert,
  isActiveClubSubscriber,
} from "../domain/deposit-policy.service.js";
import { buildAiBookingSystemPrompt } from "../../whatsapp/infra/ai/ai-booking-tool-definitions.js";

describe("Unified anti-no-show deposit policy & VIP AI prompt", () => {
  it("never charges deposit when policy is disabled", () => {
    const result = evaluateDepositPolicy({
      policy: { enabled: false, depositPercentage: 30 },
      isActiveSubscriber: false,
      servicePriceInCents: 10000,
    });
    expect(result).toEqual({
      requiresDeposit: false,
      depositAmountCents: 0,
      exemptReason: "POLICY_DISABLED",
    });
  });

  it("always exempts active Club VIP subscribers from deposit even on extra services", () => {
    const result = evaluateDepositPolicy({
      policy: { enabled: true, depositPercentage: 50 },
      isActiveSubscriber: true,
      servicePriceInCents: 12000,
    });
    expect(result).toEqual({
      requiresDeposit: false,
      depositAmountCents: 0,
      exemptReason: "ACTIVE_CLUB_SUBSCRIBER",
    });
  });

  it("calculates deposit for non-subscribers when enabled", () => {
    const result = evaluateDepositPolicy({
      policy: { enabled: true, depositPercentage: 30 },
      isActiveSubscriber: false,
      servicePriceInCents: 8000,
    });
    expect(result).toEqual({
      requiresDeposit: true,
      depositAmountCents: 2400,
      exemptReason: null,
    });
  });

  it("detects active subscribers in grace period and triggers renewal alert <= 5 days", () => {
    const now = new Date("2026-11-27T12:00:00Z");
    const expiringSoon = {
      status: "ACTIVE" as const,
      currentPeriodEnd: new Date("2026-12-01T12:00:00Z"),
      gracePeriodDays: 3,
    };
    expect(isActiveClubSubscriber(expiringSoon, now)).toBe(true);
    expect(evaluateSubscriptionRenewalAlert(expiringSoon, now, 5)).toEqual({
      daysUntilRenewal: 4,
      inGracePeriod: false,
      needsRenewalAlert: true,
    });

    const inGrace = {
      status: "PAST_DUE" as const,
      currentPeriodEnd: new Date("2026-11-26T12:00:00Z"),
      gracePeriodDays: 3,
    };
    expect(isActiveClubSubscriber(inGrace, now)).toBe(true);
    expect(evaluateSubscriptionRenewalAlert(inGrace, now, 5).needsRenewalAlert).toBe(true);
  });

  it("builds VIP-aware WhatsApp AI prompt filtering included services and alerting renewal", () => {
    const prompt = buildAiBookingSystemPrompt({
      company: {
        companyId: "comp-1",
        companyName: "Barbearia Imperial",
        timezone: "America/Sao_Paulo",
        aiSystemPrompt: null,
        services: [
          { id: "svc-corte", name: "Corte", durationMinutes: 30, priceInCents: 5000 },
          { id: "svc-barba", name: "Barba", durationMinutes: 30, priceInCents: 4000 },
          { id: "svc-quimica", name: "Platinado", durationMinutes: 90, priceInCents: 18000 },
        ],
        collaborators: [{ id: "col-1", name: "João", specialty: "Corte", serviceIds: ["svc-corte"] }],
        depositPolicy: { enabled: true, depositPercentage: 30, hasActivePaymentProvider: true },
        customerContext: {
          registeredName: "Carlos Silva",
          isSubscriber: true,
          subscription: {
            subscriptionId: "sub-1",
            planId: "plan-1",
            planName: "Clube Corte & Barba",
            status: "ACTIVE",
            includedServiceIds: ["svc-corte", "svc-barba"],
            includedServiceNames: ["Corte", "Barba"],
            allowedDaysOfWeek: null,
            maxMonthlyUses: 4,
            remainingUses: 2,
            currentPeriodEnd: "2026-11-30T12:00:00.000Z",
            daysUntilRenewal: 3,
            inGracePeriod: false,
            needsRenewalAlert: true,
          },
        },
      },
      client: { id: "cli-1", name: "Carlos", phone: "+5511999990000" },
      history: [],
      latestClientMessage: "Oi",
      now: new Date("2026-11-27T12:00:00Z"),
      tools: {} as never,
    });

    expect(prompt).toContain("ASSINANTE ATIVO DO CLUBE VIP");
    expect(prompt).toContain("Clube Corte & Barba");
    expect(prompt).toContain("R$ 0,00 — incluso no Clube VIP, sem sinal");
    expect(prompt).toContain("ALERTA DE RENOVAÇÃO OBRIGATÓRIO");
    expect(prompt).toContain("gerar_pagamento_clube");
    expect(prompt).not.toContain("Platinado (id: svc-quimica");
  });
});
