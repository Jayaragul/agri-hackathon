import { describe, it, expect } from 'vitest'
import { analyzeSoilGaps } from '../engine/soilGapAnalysis'
import { Crop, FarmProfile, SoilCorrection, RecommendationResult } from '../domain/models/models'

describe('Soil Gap Analysis', () => {
  const profile: FarmProfile = {
    acres: 1,
    ph: 8.0, // High pH
    nitrogenKgPerAcre: 10, // Deficit
    phosphorusKgPerAcre: 50,
    potassiumKgPerAcre: 50,
    soilType: 'Red Soil',
    region: 'Coimbatore',
    currentMonth: 6,
  }

  const crop: Crop = {
    id: 'test', name: 'Test', emoji: '🌱', category: 'Test', season: [], sowingMonths: [],
    idealPhMin: 6.0, idealPhMax: 7.0, nitrogenRequired: 50, phosphorusRequired: 50, potassiumRequired: 50,
    compatibleSoilTypes: [], supportedRegions: [], averageYieldKgPerAcre: 1000, durationDays: 100,
    seedCostPerAcre: 0, fertilizerCostPerAcre: 0, pesticideCostPerAcre: 0, irrigationCostPerAcre: 0,
    laborCostPerAcre: 0, machineryCostPerAcre: 0, postHarvestCostPerAcre: 0, mandiChargesPerAcre: 0,
    marketPricePerKg: 0, wastagePercent: 0, description: ''
  }

  const corrections: SoilCorrection[] = [
    { id: '1', problemKey: 'alkaline_soil', displayName: 'Alkaline', biologicalFix: '', estimatedCostPerAcre: 1000, minimumDaysBeforeSowing: 14, priority: 'high' },
    { id: '2', problemKey: 'low_nitrogen', displayName: 'Low N', biologicalFix: '', estimatedCostPerAcre: 500, minimumDaysBeforeSowing: 7, priority: 'medium' }
  ]

  const recommendation: RecommendationResult = {
    crop, score: 50, confidence: 'medium', decisionStatus: 'recommended-with-corrections',
    componentScores: { season: 0, sowingMonth: 0, ph: 0, nitrogen: 0, phosphorus: 0, potassium: 0, soilType: 0, region: 0 },
    positiveReasons: [], riskReasons: [], blockingWarnings: [],
    deficits: { nitrogenKgPerAcre: 40, phosphorusKgPerAcre: 0, potassiumKgPerAcre: 0 }, trace: []
  }

  it('detects pH and nutrient gaps and calculates totals', () => {
    const result = analyzeSoilGaps(profile, crop, corrections, recommendation)
    
    // Gaps should contain alkaline_soil and low_nitrogen
    expect(result.gaps.length).toBe(2)
    expect(result.gaps.map(g => g.correctionKey)).toContain('alkaline_soil')
    expect(result.gaps.map(g => g.correctionKey)).toContain('low_nitrogen')
    
    // Low nitrogen severity > 50% deficit (40 / 50 = 80%), so it should be critical
    const nGap = result.gaps.find(g => g.correctionKey === 'low_nitrogen')
    expect(nGap?.severity).toBe('critical')
    expect(result.hasCriticalGap).toBe(true)

    // Total cost: 1000 + 500 = 1500 per acre * 1 acre = 1500
    expect(result.totalCorrectionCost).toBe(1500)

    // Max days: Math.max(14, 7) = 14
    expect(result.maxDaysBeforeSowing).toBe(14)
  })
})
