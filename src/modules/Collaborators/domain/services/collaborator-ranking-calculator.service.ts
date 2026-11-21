import {
  DEFAULT_COMPANY_RANKING_WEIGHTS,
  resolveCompanyRankingWeights,
  type CompanyRankingWeights,
} from "../../../Company/domain/ranking-weights.js";

export interface RankingCalculationInput {
  // Pesos configuráveis pela empresa (soma = 100)
  rankingWeights?: Partial<CompanyRankingWeights> | null | undefined;

  // Pilar 1: Faturamento gerado em serviços
  servicesRevenueMonthInCents: number;
  monthlyGoalInCents: number | null;
  teamAverageServicesRevenueInCents: number;

  // Pilar 2: Vendas de produtos do estoque realizadas pelo colaborador
  productsSalesMonthInCents: number;
  teamAverageProductsSalesInCents: number;

  // Pilar 3: Volume de atendimentos concluídos no mês
  completedAppointmentsMonth: number;
  teamAverageCompletedAppointments: number;

  // Pilar 4: Avaliações de clientes (média de estrelas 1..5)
  averageRating: number | null;
  totalReviews: number;

  // Pilar 5: Pontualidade e retenção de clientes (0..100%)
  punctualityRate: number;
  clientRetentionRate: number;
}

export interface RankingPillarsBreakdown {
  servicesRevenueScore: number;
  productsSalesScore: number;
  appointmentsVolumeScore: number;
  clientReviewsScore: number;
  punctualityRetentionScore: number;
}

export interface RankingCalculationResult {
  totalScore: number; // 0 a 100
  weights: CompanyRankingWeights;
  pillars: RankingPillarsBreakdown;
  metrics: {
    averageRating: number;
    totalReviews: number;
    retentionRate: number;
    punctualityRate: number;
    servicesRevenueGoalProgress: number;
    productsSalesProgress: number;
    appointmentsVolumeProgress: number;
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp100(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Motor de Ranking e Métricas de Profissionais (CollaboratorRankingCalculator).
 * Calcula a pontuação de 0 a 100 ponderando os 5 pilares de negócio conforme os pesos definidos pelo dono.
 */
export class CollaboratorRankingCalculator {
  static calculate(input: RankingCalculationInput): RankingCalculationResult {
    const weights = resolveCompanyRankingWeights(input.rankingWeights ?? DEFAULT_COMPANY_RANKING_WEIGHTS);

    // 1. Faturamento em Serviços (meta individual quando configurada; caso contrário média da equipe)
    let servicesRevenueRaw = 0;
    if (input.monthlyGoalInCents && input.monthlyGoalInCents > 0) {
      servicesRevenueRaw = clamp100((input.servicesRevenueMonthInCents / input.monthlyGoalInCents) * 100);
    } else if (input.teamAverageServicesRevenueInCents > 0) {
      servicesRevenueRaw = clamp100(
        (input.servicesRevenueMonthInCents / input.teamAverageServicesRevenueInCents) * 100,
      );
    } else if (input.servicesRevenueMonthInCents > 0) {
      servicesRevenueRaw = 100;
    }
    const servicesRevenueScore = servicesRevenueRaw * (weights.servicesRevenueWeight / 100);

    // 2. Venda de Produtos do Estoque (comparado à média da equipe no mês; 0 seguro sem vendas)
    let productsSalesRaw = 0;
    if (input.teamAverageProductsSalesInCents > 0) {
      productsSalesRaw = clamp100(
        (input.productsSalesMonthInCents / input.teamAverageProductsSalesInCents) * 100,
      );
    } else if (input.productsSalesMonthInCents > 0) {
      productsSalesRaw = 100;
    }
    const productsSalesScore = productsSalesRaw * (weights.productsSalesWeight / 100);

    // 3. Volume de Atendimentos Concluídos no mês
    let appointmentsVolumeRaw = 0;
    if (input.teamAverageCompletedAppointments > 0) {
      appointmentsVolumeRaw = clamp100(
        (input.completedAppointmentsMonth / input.teamAverageCompletedAppointments) * 100,
      );
    } else if (input.completedAppointmentsMonth > 0) {
      appointmentsVolumeRaw = 100;
    }
    const appointmentsVolumeScore = appointmentsVolumeRaw * (weights.appointmentsVolumeWeight / 100);

    // 4. Avaliações de Clientes (nota neutra 80 para recém-contratados sem avaliações ainda)
    let clientReviewsRaw = 80;
    const avgRating = input.averageRating !== null && input.averageRating > 0 ? input.averageRating : 0;
    if (input.totalReviews > 0 && avgRating > 0) {
      clientReviewsRaw = clamp100((avgRating / 5) * 100);
    }
    const clientReviewsScore = clientReviewsRaw * (weights.clientReviewsWeight / 100);

    // 5. Pontualidade e Retenção de Clientes (média equilibrada dos dois indicadores operacionais)
    const clampedPunctuality = clamp100(input.punctualityRate);
    const clampedRetention = clamp100(input.clientRetentionRate);
    const punctualityRetentionRaw = (clampedPunctuality + clampedRetention) / 2;
    const punctualityRetentionScore =
      punctualityRetentionRaw * (weights.punctualityRetentionWeight / 100);

    const rawTotal =
      servicesRevenueScore +
      productsSalesScore +
      appointmentsVolumeScore +
      clientReviewsScore +
      punctualityRetentionScore;
    const totalScore = round1(clamp100(rawTotal));

    return {
      totalScore,
      weights,
      pillars: {
        servicesRevenueScore: round1(servicesRevenueScore),
        productsSalesScore: round1(productsSalesScore),
        appointmentsVolumeScore: round1(appointmentsVolumeScore),
        clientReviewsScore: round1(clientReviewsScore),
        punctualityRetentionScore: round1(punctualityRetentionScore),
      },
      metrics: {
        averageRating: avgRating,
        totalReviews: input.totalReviews,
        retentionRate: clampedRetention,
        punctualityRate: clampedPunctuality,
        servicesRevenueGoalProgress: round1(servicesRevenueRaw),
        productsSalesProgress: round1(productsSalesRaw),
        appointmentsVolumeProgress: round1(appointmentsVolumeRaw),
      },
    };
  }
}
