export interface BusinessMetricsSnapshot {
  companyName: string;
  currency: string;
  referenceDate: string;
  revenue: {
    todayCents: number;
    monthCents: number;
    openOrdersCount: number;
    openOrdersTotalCents: number;
  };
  appointments: {
    todayTotal: number;
    todayConfirmed: number;
    todayCompleted: number;
    monthTotal: number;
    monthCompleted: number;
    monthCanceled: number;
    monthNoShow: number;
  };
  commissions: {
    pendingCount: number;
    pendingTotalCents: number;
  };
  clients: {
    totalClients: number;
    inactive30dCount: number;
  };
  whatsapp: {
    totalConversations30d: number;
    convertedConversations30d: number;
    conversionRatePercent: number;
    stalledConversations24h: number;
    hotLeadsCount: number;
    topObjection: string;
  };
}

export interface BusinessMetricsProviderPort {
  getSnapshot(companyId: string, now?: Date): Promise<BusinessMetricsSnapshot>;
}
