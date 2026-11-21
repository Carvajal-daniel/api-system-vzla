import { describe, expect, it } from "vitest";
import { CollaboratorRankingCalculator } from "../services/collaborator-ranking-calculator.service.js";

describe("CollaboratorRankingCalculator", () => {
  it("inicia com nota neutra de 80 nas avaliações para novos profissionais usando pesos padrão", () => {
    const result = CollaboratorRankingCalculator.calculate({
      servicesRevenueMonthInCents: 100000,
      monthlyGoalInCents: 100000,
      teamAverageServicesRevenueInCents: 100000,
      productsSalesMonthInCents: 0,
      teamAverageProductsSalesInCents: 0,
      completedAppointmentsMonth: 10,
      teamAverageCompletedAppointments: 10,
      averageRating: null,
      totalReviews: 0,
      punctualityRate: 100,
      clientRetentionRate: 100,
    });

    // 80 * 0.15 = 12 nas avaliações (peso padrão 15%)
    expect(result.pillars.clientReviewsScore).toBe(12);
    expect(result.pillars.servicesRevenueScore).toBe(35);
    expect(result.pillars.productsSalesScore).toBe(0);
    expect(result.pillars.appointmentsVolumeScore).toBe(15);
    expect(result.pillars.punctualityRetentionScore).toBe(10);
    expect(result.totalScore).toBe(72);
  });

  it("calcula pontuação máxima (100) quando todos os 5 pilares estão no topo", () => {
    const result = CollaboratorRankingCalculator.calculate({
      servicesRevenueMonthInCents: 500000,
      monthlyGoalInCents: 500000,
      teamAverageServicesRevenueInCents: 400000,
      productsSalesMonthInCents: 120000,
      teamAverageProductsSalesInCents: 80000,
      completedAppointmentsMonth: 45,
      teamAverageCompletedAppointments: 30,
      averageRating: 5,
      totalReviews: 50,
      punctualityRate: 100,
      clientRetentionRate: 100,
    });

    expect(result.totalScore).toBe(100);
    expect(result.pillars.servicesRevenueScore).toBe(35);
    expect(result.pillars.productsSalesScore).toBe(25);
    expect(result.pillars.appointmentsVolumeScore).toBe(15);
    expect(result.pillars.clientReviewsScore).toBe(15);
    expect(result.pillars.punctualityRetentionScore).toBe(10);
  });

  it("aplica corretamente pesos personalizados definidos pelo dono da empresa", () => {
    const result = CollaboratorRankingCalculator.calculate({
      rankingWeights: {
        servicesRevenueWeight: 50,
        productsSalesWeight: 30,
        appointmentsVolumeWeight: 10,
        clientReviewsWeight: 5,
        punctualityRetentionWeight: 5,
      },
      servicesRevenueMonthInCents: 200000,
      monthlyGoalInCents: 200000,
      teamAverageServicesRevenueInCents: 200000,
      productsSalesMonthInCents: 50000,
      teamAverageProductsSalesInCents: 100000,
      completedAppointmentsMonth: 20,
      teamAverageCompletedAppointments: 20,
      averageRating: 5,
      totalReviews: 10,
      punctualityRate: 100,
      clientRetentionRate: 100,
    });

    expect(result.pillars.servicesRevenueScore).toBe(50);
    expect(result.pillars.productsSalesScore).toBe(15);
    expect(result.pillars.appointmentsVolumeScore).toBe(10);
    expect(result.pillars.clientReviewsScore).toBe(5);
    expect(result.pillars.punctualityRetentionScore).toBe(5);
    expect(result.totalScore).toBe(85);
  });
});
