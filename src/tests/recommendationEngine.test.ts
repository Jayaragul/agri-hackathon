import { describe, it, expect } from 'vitest'
import { evaluateCrop, rankCrops } from '../engine/recommendationEngine'
import { Crop, FarmProfile } from '../domain/models/models'

describe('Recommendation Engine', () => {
  const profile: FarmProfile = {
    acres: 1,
    ph: 6.5,
    nitrogenKgPerAcre: 50,
    phosphorusKgPerAcre: 50,
    potassiumKgPerAcre: 50,
    soilType: 'Red Soil',
    region: 'Coimbatore',
    currentMonth: 6,
  }

  const goodCrop: Crop = {
    id: 'test-good', name: 'Test Good', emoji: '🌱', category: 'Test', season: ['Kharif'], sowingMonths: [6],
    idealPhMin: 6.0, idealPhMax: 7.0, nitrogenRequired: 40, phosphorusRequired: 40, potassiumRequired: 40,
    compatibleSoilTypes: ['Red Soil'], supportedRegions: ['Coimbatore'], averageYieldKgPerAcre: 1000, durationDays: 100,
    seedCostPerAcre: 0, fertilizerCostPerAcre: 0, pesticideCostPerAcre: 0, irrigationCostPerAcre: 0,
    laborCostPerAcre: 0, machineryCostPerAcre: 0, postHarvestCostPerAcre: 0, mandiChargesPerAcre: 0,
    marketPricePerKg: 0, wastagePercent: 0, description: ''
  }

  const badCrop: Crop = {
    id: 'test-bad', name: 'Test Bad', emoji: '🌱', category: 'Test', season: ['Rabi'], sowingMonths: [1],
    idealPhMin: 8.0, idealPhMax: 9.0, nitrogenRequired: 100, phosphorusRequired: 100, potassiumRequired: 100,
    compatibleSoilTypes: ['Black Soil'], supportedRegions: ['Chennai'], averageYieldKgPerAcre: 1000, durationDays: 100,
    seedCostPerAcre: 0, fertilizerCostPerAcre: 0, pesticideCostPerAcre: 0, irrigationCostPerAcre: 0,
    laborCostPerAcre: 0, machineryCostPerAcre: 0, postHarvestCostPerAcre: 0, mandiChargesPerAcre: 0,
    marketPricePerKg: 0, wastagePercent: 0, description: ''
  }

  it('evaluates a perfectly matched crop with high score and confidence', () => {
    const result = evaluateCrop(profile, goodCrop)
    
    // Total should be 100 for perfect match
    expect(result.score).toBe(100)
    expect(result.confidence).toBe('high')
    expect(result.decisionStatus).toBe('recommended')
    expect(result.deficits.nitrogenKgPerAcre).toBe(0)
    
    const hasCritical = result.trace.some(t => t.status === 'critical')
    expect(hasCritical).toBe(false)
  })

  it('heavily penalizes an incompatible crop and identifies critical failures', () => {
    const result = evaluateCrop(profile, badCrop)
    
    expect(result.score).toBeLessThan(40) // Will be 0 or very low
    expect(result.confidence).toBe('low')
    expect(result.decisionStatus).toBe('not-currently-feasible')
    
    expect(result.deficits.nitrogenKgPerAcre).toBe(50) // Requires 100, has 50
    
    const criticalTraces = result.trace.filter(t => t.status === 'critical')
    expect(criticalTraces.length).toBeGreaterThan(0)
  })

  it('ranks crops correctly based on suitability', () => {
    const ranked = rankCrops(profile, [badCrop, goodCrop])
    expect(ranked[0].crop.id).toBe('test-good')
    expect(ranked[1].crop.id).toBe('test-bad')
  })

  it.each([
    [40, 'Nitrogen requirement is fully covered.'],
    [36, 'Small nitrogen deficit; minor supplementation is recommended.'],
    [24, 'Moderate nitrogen deficit; correction is required before sowing.'],
    [12, 'Severe nitrogen deficit; crop performance is at high risk.']
  ])('explains nitrogen severity when %s kg per acre is available', (available, expectedMessage) => {
    const result = evaluateCrop({ ...profile, nitrogenKgPerAcre: available }, goodCrop)
    const nitrogenTrace = result.trace.find(entry => entry.factor === 'nitrogen')

    expect(nitrogenTrace?.explanation).toBe(expectedMessage)
  })

  it('separates a strong agronomic score from its correction requirement', () => {
    const result = evaluateCrop({ ...profile, nitrogenKgPerAcre: 36 }, goodCrop)

    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.decisionStatus).toBe('recommended-with-corrections')
  })
})
