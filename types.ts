
export interface Source {
  uri: string;
  title: string;
}

export interface RecentNews {
  headline: string;
  impact: string;
}

export interface KeyFinancials {
  revenueLTM: string;
  netIncomeLTM: string;
  cashFlowLTM: string;
  keyRatios: string;
}

export interface AnalysisResult {
  companyName: string;
  tickerSymbol: string;
  valuationSummary: string;
  keyFinancials: KeyFinancials;
  recentNewsAnalysis: RecentNews[];
  priceAdjustmentReasoning: string;
  finalRecommendation: string;
}

export interface PitchDeckSlide {
  slideNumber: number;
  title: string;
  bulletPoints: string[];
}
