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

/** Itemized cost lines, each already scaled to total acres (not per-acre). Sums to `totalInvestment`. */
export interface FinancialCostBreakdown {
  seed: number;
  fertilizer: number;
  pesticide: number;
  irrigation: number;
  labor: number;
  machinery: number;
  postHarvest: number;
  mandiCharges: number;
  soilCorrection: number;
}

export interface FinancialResult {
  totalCostPerAcre: number;
  totalInvestment: number;
  costBreakdown: FinancialCostBreakdown;
  grossYieldKg: number;
  saleableYieldKg: number;
  grossRevenue: number;
  /** The scenario-adjusted market price actually used for `grossRevenue` — avoids the caller back-deriving it via `grossRevenue / saleableYieldKg`, which is fragile at zero yield. */
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
  | 'action-plan'
  | 'calendar'
  | 'digital-twin'
  | 'advisor'
  | 'crop-doctor'
  | 'audio-mode';

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

/**
 * `proactive`: the deterministic engine predicted this ahead of time (a calendar milestone, a
 * pest-risk window opening) — never AI-invented. `reactive`: something the farmer or an agent
 * observed as it happened, which no calendar could have predicted. See [[krishi-mitra-ai-boundary]].
 */
export type FarmEventMode = 'proactive' | 'reactive';

export type FarmEventKind = 'observation' | 'action' | 'alert' | 'milestone' | 'lab-report';

/** Who reported this event — never "engine" for a `reactive` event, never "farmer" for a `proactive` one. */
export type FarmEventSource = 'farmer' | 'engine' | 'agent';

/**
 * One entry in the farm's shared timeline — the "calendar that stores everything" read by
 * every agent through `services/context/farmContext.ts`, so a pest observed in Crop Doctor or a
 * situation mentioned in Audio Mode is visible to the General Farm Advisor too, and vice versa.
 * Proactive entries are computed fresh from `engine/proactiveEngine.ts` (never persisted, since
 * "today" moves); reactive entries are persisted via `services/timeline/farmTimeline.ts`.
 */
export interface FarmTimelineEvent {
  id: string;
  createdAtIso: string;
  mode: FarmEventMode;
  kind: FarmEventKind;
  source: FarmEventSource;
  title: string;
  detail: string;
  cropId?: string | null;
  /** Ties back to `CalendarDay.dayIndex` when this event is anchored to a specific cultivation day. */
  dayIndex?: number | null;
}

export interface TranslationProvider {
  translate(
    text: string,
    targetLanguage: "en" | "ta"
  ): Promise<string>;
}

/**
 * One day of Google Weather API forecast, already mapped down to what this app uses — see
 * `server/src/services/weatherProxy.ts` for the raw-to-clean mapping. Every numeric field is
 * nullable because "not reported for this day" must be representable rather than defaulted to 0,
 * which would read as a real (and wrong) measurement to `engine/weatherRules.ts`.
 */
export interface WeatherForecastDay {
  dateIso: string;
  minTempC: number | null;
  maxTempC: number | null;
  rainProbabilityPercent: number | null;
  rainQpfMm: number | null;
  windSpeedKph: number | null;
  humidityPercent: number | null;
  thunderstormProbabilityPercent: number | null;
  conditionType: string | null;
}
