import { FarmProfile, Crop, RecommendationResult } from '../domain/models/models'
import { SCORE_WEIGHTS } from '../domain/constants/constants'
import { evaluateConfidence } from './confidenceEngine'
import { DecisionTraceBuilder } from './decisionTraceBuilder'
import { analyzeNutrient, evaluatePh } from './nutrientAnalysis'

const nutrientMessages = {
  none: (name: string) => `${name} requirement is fully covered.`,
  mild: (name: string) => `Small ${name.toLowerCase()} deficit; minor supplementation is recommended.`,
  moderate: (name: string) => `Moderate ${name.toLowerCase()} deficit; correction is required before sowing.`,
  severe: (name: string) => `Severe ${name.toLowerCase()} deficit; crop performance is at high risk.`
} as const

function nutrientMessage(name: string, severity: keyof typeof nutrientMessages): string {
  return nutrientMessages[severity](name)
}

export function evaluateCrop(profile: FarmProfile, crop: Crop): RecommendationResult {
  const trace = new DecisionTraceBuilder()
  
  let totalScore = 0
  const componentScores = {
    season: 0, sowingMonth: 0, ph: 0, nitrogen: 0,
    phosphorus: 0, potassium: 0, soilType: 0, region: 0
  }

  // 1. Season & Sowing Month
  const isMonthValid = crop.sowingMonths.includes(profile.currentMonth)
  if (isMonthValid) {
    componentScores.sowingMonth = SCORE_WEIGHTS.sowingMonth
    totalScore += SCORE_WEIGHTS.sowingMonth
    trace.addFactor('sowingMonth', profile.currentMonth, crop.sowingMonths.join(', '), SCORE_WEIGHTS.sowingMonth, SCORE_WEIGHTS.sowingMonth, 'Sowing month is highly suitable.')
    
    // Automatically award season points if month is valid
    componentScores.season = SCORE_WEIGHTS.season
    totalScore += SCORE_WEIGHTS.season
    trace.addFactor('season', 'valid', 'valid', SCORE_WEIGHTS.season, SCORE_WEIGHTS.season, 'Matches typical seasonal patterns.')
  } else {
    trace.addCriticalFailure('sowingMonth', profile.currentMonth, crop.sowingMonths.join(', '), `Current month (${profile.currentMonth}) is outside the recommended sowing window.`)
    trace.addFactor('season', 'invalid', 'valid', 0, SCORE_WEIGHTS.season, 'Season timing is incorrect due to month mismatch.')
  }

  // 2. pH
  const phResult = evaluatePh(profile.ph, crop.idealPhMin, crop.idealPhMax, SCORE_WEIGHTS.ph)
  componentScores.ph = phResult.score
  totalScore += phResult.score
  if (phResult.deviation >= 1.5) {
    trace.addCriticalFailure('ph', profile.ph, `${crop.idealPhMin}-${crop.idealPhMax}`, `Soil pH is dangerously far from crop tolerance.`)
  } else if (phResult.deviation > 0) {
    trace.addFactor('ph', profile.ph, `${crop.idealPhMin}-${crop.idealPhMax}`, phResult.score, SCORE_WEIGHTS.ph, 'pH is slightly outside ideal range but manageable.')
  } else {
    trace.addFactor('ph', profile.ph, `${crop.idealPhMin}-${crop.idealPhMax}`, phResult.score, SCORE_WEIGHTS.ph, 'pH is perfectly within ideal range.')
  }

  // 3. NPK
  const nResult = analyzeNutrient(profile.nitrogenKgPerAcre, crop.nitrogenRequired, SCORE_WEIGHTS.nitrogen)
  componentScores.nitrogen = nResult.score
  totalScore += nResult.score
  trace.addFactor('nitrogen', profile.nitrogenKgPerAcre, crop.nitrogenRequired, nResult.score, SCORE_WEIGHTS.nitrogen, 
    nutrientMessage('Nitrogen', nResult.severity))

  const pResult = analyzeNutrient(profile.phosphorusKgPerAcre, crop.phosphorusRequired, SCORE_WEIGHTS.phosphorus)
  componentScores.phosphorus = pResult.score
  totalScore += pResult.score
  trace.addFactor('phosphorus', profile.phosphorusKgPerAcre, crop.phosphorusRequired, pResult.score, SCORE_WEIGHTS.phosphorus, 
    nutrientMessage('Phosphorus', pResult.severity))

  const kResult = analyzeNutrient(profile.potassiumKgPerAcre, crop.potassiumRequired, SCORE_WEIGHTS.potassium)
  componentScores.potassium = kResult.score
  totalScore += kResult.score
  trace.addFactor('potassium', profile.potassiumKgPerAcre, crop.potassiumRequired, kResult.score, SCORE_WEIGHTS.potassium, 
    nutrientMessage('Potassium', kResult.severity))

  // 4. Soil Type
  const isSoilMatch = crop.compatibleSoilTypes.some(s => s.toLowerCase() === profile.soilType.toLowerCase())
  if (isSoilMatch) {
    componentScores.soilType = SCORE_WEIGHTS.soilType
    totalScore += SCORE_WEIGHTS.soilType
    trace.addFactor('soilType', profile.soilType, crop.compatibleSoilTypes.join(', '), SCORE_WEIGHTS.soilType, SCORE_WEIGHTS.soilType, 'Excellent match for this soil type.')
  } else {
    trace.addFactor('soilType', profile.soilType, crop.compatibleSoilTypes.join(', '), 0, SCORE_WEIGHTS.soilType, 'Crop is not typically grown in this soil type.')
  }

  // 5. Region
  const isRegionMatch = crop.supportedRegions.some(r => r.toLowerCase() === profile.region.toLowerCase())
  if (isRegionMatch) {
    componentScores.region = SCORE_WEIGHTS.region
    totalScore += SCORE_WEIGHTS.region
    trace.addFactor('region', profile.region, crop.supportedRegions.join(', '), SCORE_WEIGHTS.region, SCORE_WEIGHTS.region, 'Strong historical yield data in your region.')
  } else {
    trace.addFactor('region', profile.region, crop.supportedRegions.join(', '), 0, SCORE_WEIGHTS.region, 'No historical yield data in your region.')
  }

  // Determine Confidence and Status
  const { confidence, reason: confReason } = evaluateConfidence(profile, crop)
  
  let decisionStatus: RecommendationResult['decisionStatus'] = 'not-currently-feasible'
  const hasCritical = trace.getTrace().some(t => t.status === 'critical')
  const requiresCorrection = phResult.deviation > 0 || [nResult, pResult, kResult].some(result => result.severity !== 'none')
  
  if (totalScore >= 80 && !hasCritical && !requiresCorrection) {
    decisionStatus = 'recommended'
  } else if (totalScore >= 60 && !hasCritical) {
    decisionStatus = 'recommended-with-corrections'
  } else if (totalScore >= 40) {
    decisionStatus = 'high-risk'
  } else {
    decisionStatus = 'not-currently-feasible'
  }

  return {
    crop,
    score: Math.round(totalScore),
    confidence,
    decisionStatus,
    componentScores,
    positiveReasons: trace.getPositiveReasons(),
    riskReasons: [...trace.getRiskReasons(), confReason],
    blockingWarnings: trace.getBlockingWarnings(),
    deficits: {
      nitrogenKgPerAcre: nResult.deficit,
      phosphorusKgPerAcre: pResult.deficit,
      potassiumKgPerAcre: kResult.deficit
    },
    trace: trace.getTrace()
  }
}

export function rankCrops(profile: FarmProfile, crops: Crop[]): RecommendationResult[] {
  return crops
    .map(crop => evaluateCrop(profile, crop))
    .sort((a, b) => b.score - a.score)
}
