import { describe, expect, it } from "vitest";
import type { InactiveClientRecord } from "../infra/http/inactive-clients.js";
import { analyzeRecoveryReasons, buildHeuristicReasons } from "../infra/http/recovery-providers.js";

const baseClient: InactiveClientRecord = {
  id: "c_5511999999999",
  name: "Marcos Pereira",
  phone: "+5511999999999",
  lastVisit: {
    serviceName: "Corte + Barba",
    price: 9000,
    collaboratorName: "Rafael",
    completedAt: "2026-10-01T15:00:00.000Z",
    daysSinceLastVisit: 53,
  },
  lastReview: {
    stars: 2,
    comment: "Demorou muito para ser atendido.",
    createdAt: "2026-10-01T18:00:00.000Z",
  },
  lastCancellation: null,
  historySummary: {
    totalVisits: 5,
    averageVisitIntervalDays: 21,
    recentCancellations: 0,
    recentNoShows: 0,
    changedCollaborator: true,
    priceDeltaPercent: 15,
  },
  diagnosticTag: "LOW_RATING",
};

describe("Client recovery diagnostic analysis", () => {
  it("highlights low review, professional change and price/frequency signals in pt-BR", () => {
    const analysis = buildHeuristicReasons(baseClient, "pt-BR");

    expect(analysis.reasons.length).toBeGreaterThanOrEqual(2);
    expect(analysis.reasons.length).toBeLessThanOrEqual(3);
    expect(analysis.reasons[0]).toContain("2/5");
    expect(analysis.reasons[0]).toContain("Demorou muito");
    expect(analysis.suggestedApproach.toLowerCase()).toContain("empatia");
  });

  it("produces Spanish diagnostic bullets for canceled-without-rebook clients", async () => {
    const canceledClient: InactiveClientRecord = {
      ...baseClient,
      lastReview: null,
      lastCancellation: {
        canceledAt: "2026-10-20T12:00:00.000Z",
        cancelReason: "Imprevisto laboral",
      },
      historySummary: {
        ...baseClient.historySummary,
        recentCancellations: 1,
        changedCollaborator: false,
        priceDeltaPercent: null,
      },
      diagnosticTag: "CANCELED_WITHOUT_REBOOK",
    };

    const result = await analyzeRecoveryReasons({
      locale: "es",
      company: "Barbería Central",
      client: canceledClient,
    });

    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons[0]).toContain("Imprevisto laboral");
    expect(result.suggestedApproach.length).toBeGreaterThan(10);
  });
});
