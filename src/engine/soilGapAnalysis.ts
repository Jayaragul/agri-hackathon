import { FarmProfile, Crop, SoilCorrection, SoilGapAnalysisResult, DetectedGap, RecommendationResult } from '../domain/models/models'

export function analyzeSoilGaps(
  profile: FarmProfile,
  crop: Crop,
  corrections: SoilCorrection[],
  recommendation: RecommendationResult
): SoilGapAnalysisResult {
  const gaps: DetectedGap[] = []
  
  const getCorrection = (key: string) => corrections.find(c => c.problemKey === key) || null

  // 1. pH Gaps
  if (profile.ph < 5.0) {
    gaps.push({
      correctionKey: 'extreme_acidity',
      severity: 'critical',
      gapLabel: 'Severe Acidity',
      cropContext: `pH ${profile.ph} is far below ${crop.name}'s ideal range (${crop.idealPhMin}-${crop.idealPhMax})`,
      correction: getCorrection('extreme_acidity')
    })
  } else if (profile.ph < crop.idealPhMin) {
    gaps.push({
      correctionKey: 'acidic_soil',
      severity: 'warning',
      gapLabel: 'Acidic Soil',
      cropContext: `pH ${profile.ph} is below ${crop.name}'s ideal minimum (${crop.idealPhMin})`,
      correction: getCorrection('acidic_soil')
    })
  }

  if (profile.ph > 8.5) {
    gaps.push({
      correctionKey: 'extreme_alkalinity',
      severity: 'critical',
      gapLabel: 'Severe Alkalinity',
      cropContext: `pH ${profile.ph} is far above ${crop.name}'s ideal range (${crop.idealPhMin}-${crop.idealPhMax})`,
      correction: getCorrection('extreme_alkalinity')
    })
  } else if (profile.ph > crop.idealPhMax) {
    gaps.push({
      correctionKey: 'alkaline_soil',
      severity: 'warning',
      gapLabel: 'Alkaline Soil',
      cropContext: `pH ${profile.ph} is above ${crop.name}'s ideal maximum (${crop.idealPhMax})`,
      correction: getCorrection('alkaline_soil')
    })
  }

  // 2. NPK Deficits
  const { nitrogenKgPerAcre, phosphorusKgPerAcre, potassiumKgPerAcre } = recommendation.deficits

  if (nitrogenKgPerAcre > 0) {
    gaps.push({
      correctionKey: 'low_nitrogen',
      severity: nitrogenKgPerAcre > crop.nitrogenRequired * 0.5 ? 'critical' : 'warning',
      gapLabel: 'Nitrogen Deficit',
      cropContext: `Missing ${nitrogenKgPerAcre} kg/acre for ${crop.name}`,
      correction: getCorrection('low_nitrogen')
    })
  }

  if (phosphorusKgPerAcre > 0) {
    // If pH is high, it might be phosphorus fixation
    const pKey = profile.ph > 7.5 ? 'phosphorus_fixation' : 'low_phosphorus'
    gaps.push({
      correctionKey: pKey,
      severity: phosphorusKgPerAcre > crop.phosphorusRequired * 0.5 ? 'critical' : 'warning',
      gapLabel: 'Phosphorus Deficit',
      cropContext: `Missing ${phosphorusKgPerAcre} kg/acre for ${crop.name}`,
      correction: getCorrection(pKey)
    })
  }

  if (potassiumKgPerAcre > 0) {
    gaps.push({
      correctionKey: 'low_potassium',
      severity: potassiumKgPerAcre > crop.potassiumRequired * 0.5 ? 'critical' : 'warning',
      gapLabel: 'Potassium Deficit',
      cropContext: `Missing ${potassiumKgPerAcre} kg/acre for ${crop.name}`,
      correction: getCorrection('low_potassium')
    })
  }

  // Deduplicate and calculate totals
  const uniqueCorrections = new Map<string, SoilCorrection>()
  gaps.forEach(g => {
    if (g.correction && !uniqueCorrections.has(g.correction.id)) {
      uniqueCorrections.set(g.correction.id, g.correction)
    }
  })

  let totalCostPerAcre = 0
  let maxDays = 0
  uniqueCorrections.forEach(c => {
    totalCostPerAcre += c.estimatedCostPerAcre
    if (c.minimumDaysBeforeSowing > maxDays) {
      maxDays = c.minimumDaysBeforeSowing
    }
  })

  return {
    gaps,
    totalCorrectionCost: totalCostPerAcre * profile.acres,
    maxDaysBeforeSowing: maxDays,
    hasCriticalGap: gaps.some(g => g.severity === 'critical')
  }
}
