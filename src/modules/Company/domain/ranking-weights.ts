export interface CompanyRankingWeights {
  servicesRevenueWeight: number;
  productsSalesWeight: number;
  appointmentsVolumeWeight: number;
  clientReviewsWeight: number;
  punctualityRetentionWeight: number;
}

/**
 * Pesos padrão voltados às métricas principais de negócio do dono (soma = 100).
 */
export const DEFAULT_COMPANY_RANKING_WEIGHTS: CompanyRankingWeights = {
  servicesRevenueWeight: 35,
  productsSalesWeight: 25,
  appointmentsVolumeWeight: 15,
  clientReviewsWeight: 15,
  punctualityRetentionWeight: 10,
};

/**
 * Normaliza e garante que a empresa sempre possua um objeto válido de pesos somando 100.
 */
export function resolveCompanyRankingWeights(
  raw?: Partial<CompanyRankingWeights> | null,
): CompanyRankingWeights {
  if (!raw) return { ...DEFAULT_COMPANY_RANKING_WEIGHTS };

  const candidate: CompanyRankingWeights = {
    servicesRevenueWeight: Number(raw.servicesRevenueWeight ?? DEFAULT_COMPANY_RANKING_WEIGHTS.servicesRevenueWeight),
    productsSalesWeight: Number(raw.productsSalesWeight ?? DEFAULT_COMPANY_RANKING_WEIGHTS.productsSalesWeight),
    appointmentsVolumeWeight: Number(raw.appointmentsVolumeWeight ?? DEFAULT_COMPANY_RANKING_WEIGHTS.appointmentsVolumeWeight),
    clientReviewsWeight: Number(raw.clientReviewsWeight ?? DEFAULT_COMPANY_RANKING_WEIGHTS.clientReviewsWeight),
    punctualityRetentionWeight: Number(raw.punctualityRetentionWeight ?? DEFAULT_COMPANY_RANKING_WEIGHTS.punctualityRetentionWeight),
  };

  const values = Object.values(candidate);
  const allValid = values.every((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  const sum = values.reduce((acc, v) => acc + v, 0);

  if (!allValid || sum !== 100) {
    return { ...DEFAULT_COMPANY_RANKING_WEIGHTS };
  }

  return candidate;
}
