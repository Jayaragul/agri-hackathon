export interface FarmProfile {
  ph: number;
  nitrogenKgPerAcre: number;
  phosphorusKgPerAcre: number;
  potassiumKgPerAcre: number;
  soilType: string;
  region: string;
  acres: number;
  currentMonth: number;
}

export interface DatasetMetadata {
  name: string;
  version: string;
  region: string;
  sourceType: 'demo' | 'expert-reviewed' | 'official' | 'research';
  lastUpdated: string;
  limitations: string[];
}

export interface Crop {
  id: string;
  name: string;
  emoji: string;
  category: string;
  season: string[];
  sowingMonths: number[];
  idealPhMin: number;
  idealPhMax: number;
  nitrogenRequired: number;
  phosphorusRequired: number;
  potassiumRequired: number;
  compatibleSoilTypes: string[];
  supportedRegions: string[];
  averageYieldKgPerAcre: number;
  durationDays: number;
  seedCostPerAcre: number;
  fertilizerCostPerAcre: number;
  pesticideCostPerAcre: number;
  irrigationCostPerAcre: number;
  laborCostPerAcre: number;
  machineryCostPerAcre: number;
  postHarvestCostPerAcre: number;
  mandiChargesPerAcre: number;
  marketPricePerKg: number;
  wastagePercent: number;
  description: string;
}

export interface SoilType {
  series: string;
  symbol: string;
  phRange: string;
  texture: string;
  locations: string[];
  suitableCrops: string[];
  productivity: string;
  characteristics: string;
}

export type CorrectionsKey = string;

export interface SoilCorrection {
  id: string;
  problemKey: CorrectionsKey;
  displayName: string;
  biologicalFix: string;
  physicalFix?: string;
  chemicalFix?: string;
  estimatedCostPerAcre: number;
  minimumDaysBeforeSowing: number;
  safetyNote?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface PestRisk {
  id: string;
  cropId: string;
  pestName: string;
  pestEmoji: string;
  riskLevel: 'low' | 'medium' | 'high';
  symptoms: string;
  biologicalControl: string;
  chemicalControl?: string;
  economicThreshold: string;
}

export interface DecisionTraceEntry {
  factor: 'season' | 'sowingMonth' | 'ph' | 'nitrogen' | 'phosphorus' | 'potassium' | 'soilType' | 'region' | 'financialRisk';
  inputValue: string | number;
  requiredValue: string | number;
  pointsAwarded: number;
  maximumPoints: number;
  status: 'good' | 'warning' | 'critical';
  explanation: string;
}

export interface RecommendationResult {
  crop: Crop;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  decisionStatus: 'recommended' | 'recommended-with-corrections' | 'high-risk' | 'not-currently-feasible';
  componentScores: {
    season: number;
    sowingMonth: number;
    ph: number;
    nitrogen: number;
    phosphorus: number;
    potassium: number;
    soilType: number;
    region: number;
  };
  positiveReasons: string[];
  riskReasons: string[];
  blockingWarnings: string[];
  deficits: {
    nitrogenKgPerAcre: number;
    phosphorusKgPerAcre: number;
    potassiumKgPerAcre: number;
  };
  trace: DecisionTraceEntry[];
}

export interface ScenarioAssumptions {
  yieldFactor: number;
  priceFactor: number;
  costFactor: number;
}

export interface FinancialResult {
  costBreakdown: {
    seed: number;
    fertilizer: number;
    pesticide: number;
    irrigation: number;
    labor: number;
    machinery: number;
    postHarvest: number;
    mandiCharges: number;
    soilCorrection: number;
  };
  totalCostPerAcre: number;
  totalInvestment: number;
  grossYieldKg: number;
  saleableYieldKg: number;
  grossRevenue: number;
  effectivePricePerKg: number;
  netProfit: number;
  roi: number;
  breakEvenPricePerKg: number;
  profitPerAcre: number;
  isLoss: boolean;
}

export interface FinancialScenarioSet {
  conservative: FinancialResult;
  expected: FinancialResult;
  optimistic: FinancialResult;
}

export interface DetectedGap {
  correctionKey: CorrectionsKey;
  severity: 'critical' | 'warning' | 'info';
  gapLabel: string;
  cropContext: string;
  correction: SoilCorrection | null;
}

export interface SoilGapAnalysisResult {
  gaps: DetectedGap[];
  totalCorrectionCost: number;
  maxDaysBeforeSowing: number;
  hasCriticalGap: boolean;
}

export type AppStage =
  | 'farm-profile'
  | 'recommendations'
  | 'soil-corrections'
  | 'financials'
  | 'pests'
  | 'action-plan';

export interface ExplanationProvider {
  explainRecommendation(
    result: RecommendationResult,
    profile: FarmProfile
  ): Promise<string>;
}

// Future AI Harness Extension Interfaces
export interface SpeechInputProvider {
  startListening(): Promise<string>;
  stopListening(): void;
}

export interface SpeechOutputProvider {
  speak(text: string, language: string): Promise<void>;
}

export interface SoilReportExtractor {
  extract(file: File): Promise<Partial<FarmProfile>>;
}

export interface TranslationProvider {
  translate(
    text: string,
    targetLanguage: "en" | "ta"
  ): Promise<string>;
}
