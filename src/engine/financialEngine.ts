import { Crop, FarmProfile, FinancialResult, FinancialScenarioSet, ScenarioAssumptions, SoilGapAnalysisResult } from '../domain/models/models'

export function calculateScenario(
  profile: FarmProfile,
  crop: Crop,
  gapAnalysis: SoilGapAnalysisResult,
  assumptions: ScenarioAssumptions
): FinancialResult {
  const acres = profile.acres

  // Apply assumption factors
  const adjustedYieldPerAcre = crop.averageYieldKgPerAcre * assumptions.yieldFactor
  const adjustedPricePerKg = crop.marketPricePerKg * assumptions.priceFactor

  // Itemized cost lines, scaled to total acres. Soil correction is excluded from `costFactor`
  // (it is a fixed pre-farming quote from the corrections dataset, not a cultivation input that
  // scales with the scenario's cost overrun/savings assumption).
  const scaledCost = (costPerAcre: number) => costPerAcre * assumptions.costFactor * acres
  const costBreakdown = {
    seed: scaledCost(crop.seedCostPerAcre),
    fertilizer: scaledCost(crop.fertilizerCostPerAcre),
    pesticide: scaledCost(crop.pesticideCostPerAcre),
    irrigation: scaledCost(crop.irrigationCostPerAcre),
    labor: scaledCost(crop.laborCostPerAcre),
    machinery: scaledCost(crop.machineryCostPerAcre),
    postHarvest: scaledCost(crop.postHarvestCostPerAcre),
    mandiCharges: scaledCost(crop.mandiChargesPerAcre),
    soilCorrection: gapAnalysis.totalCorrectionCost,
  }

  const totalInvestment = Object.values(costBreakdown).reduce((sum, cost) => sum + cost, 0)
  const totalCostPerAcre = acres > 0 ? totalInvestment / acres : 0

  const grossYieldKg = adjustedYieldPerAcre * acres
  
  // Calculate wastage
  const wastageMultiplier = 1 - (crop.wastagePercent / 100)
  const saleableYieldKg = Math.max(0, grossYieldKg * wastageMultiplier)

  const grossRevenue = saleableYieldKg * adjustedPricePerKg
  
  const netProfit = grossRevenue - totalInvestment
  const profitPerAcre = acres > 0 ? netProfit / acres : 0
  
  const isLoss = netProfit < 0
  
  // Avoid division by zero
  const roi = totalInvestment > 0 ? (netProfit / totalInvestment) * 100 : 0
  const breakEvenPricePerKg = saleableYieldKg > 0 ? totalInvestment / saleableYieldKg : 0

  return {
    totalCostPerAcre,
    totalInvestment,
    costBreakdown,
    grossYieldKg,
    saleableYieldKg,
    grossRevenue,
    effectivePricePerKg: adjustedPricePerKg,
    netProfit,
    roi,
    breakEvenPricePerKg,
    profitPerAcre,
    isLoss
  }
}

export function generateFinancialScenarios(
  profile: FarmProfile,
  crop: Crop,
  gapAnalysis: SoilGapAnalysisResult
): FinancialScenarioSet {
  
  return {
    conservative: calculateScenario(profile, crop, gapAnalysis, {
      yieldFactor: 0.75, // 25% lower yield
      priceFactor: 0.85, // 15% price drop
      costFactor: 1.15   // 15% cost overrun
    }),
    expected: calculateScenario(profile, crop, gapAnalysis, {
      yieldFactor: 1.0,
      priceFactor: 1.0,
      costFactor: 1.0
    }),
    optimistic: calculateScenario(profile, crop, gapAnalysis, {
      yieldFactor: 1.15, // 15% better yield
      priceFactor: 1.10, // 10% price bump
      costFactor: 0.95   // 5% cost savings
    })
  }
}
