import type { PlanLimits, PlanTier } from "../entities/tenant-usage.types.js";

// Janela de 6 horas usada para agrupar mensagens de um mesmo atendimento em uma única Sessão IA.
export const AI_SESSION_WINDOW_HOURS = 6;
export const AI_SESSION_WINDOW_MS = AI_SESSION_WINDOW_HOURS * 60 * 60 * 1000;

const PLAN_LIMITS_TABLE: Readonly<Record<PlanTier, PlanLimits>> = {
  TRIAL: {
    tier: "TRIAL",
    planName: "Trial",
    aiSessionsLimit: 20,
    outboundMessagesLimit: 300,
  },
  PRO: {
    tier: "PRO",
    planName: "Pro",
    aiSessionsLimit: 1500,
    outboundMessagesLimit: 3000,
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    planName: "Enterprise",
    aiSessionsLimit: 10000,
    outboundMessagesLimit: 30000,
  },
};

// Centraliza os limites de consumo por plano no domínio para evitar números mágicos espalhados.
export class PlanLimitsResolver {
  public resolve(tier?: PlanTier | null): PlanLimits {
    if (!tier || !(tier in PLAN_LIMITS_TABLE)) {
      return PLAN_LIMITS_TABLE.TRIAL;
    }
    return PLAN_LIMITS_TABLE[tier];
  }
}

export function formatPeriodMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function computeQuotaPercentage(used: number, limit: number): number {
  if (limit <= 0) {
    return 100;
  }
  const raw = (Math.max(0, used) / limit) * 100;
  return Math.round(raw * 100) / 100;
}
