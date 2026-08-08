import cropRows from './crop.json'
import correctionRows from './chemandbio.json'
import pestRows from './pest.json'
import { sampleCrops } from './sample/crops'
import { sampleCorrections } from './sample/corrections'
import { samplePests } from './sample/pests'
import { Crop, PestRisk, SoilCorrection } from '../domain/models/models'

type CropRow = typeof cropRows[number]
type CorrectionRow = typeof correctionRows[number]
type PestGroup = typeof pestRows[number]

const cropRowById = new Map((cropRows as CropRow[]).map(row => [row.id, row]))

const soilName = (value: string) => {
  const names: Record<string, string> = {
    'Red Calcareous': 'Red Calcareous Soil',
    'Alluvial and Colluvial': 'Alluvial and Colluvial Soil',
    'Red Non-Calcareous': 'Red Non-Calcareous Soil',
    'Brown Soil': 'Brown Soil',
  }
  return names[value] || value
}

// The JSON files are the normalized, validated import of the project research sheets.
// Sample records still provide display metadata where the sheets do not carry it.
export const spreadsheetCrops: Crop[] = sampleCrops.map(sample => {
  const row = cropRowById.get(sample.id)
  if (!row) return sample
  return {
    ...sample,
    name: row.name,
    category: row.category,
    season: row.season,
    sowingMonths: row.sowing_months,
    idealPhMin: row.ideal_ph_min,
    idealPhMax: row.ideal_ph_max,
    nitrogenRequired: row.N_kg_ac,
    phosphorusRequired: row.P_kg_ac,
    potassiumRequired: row.K_kg_ac,
    compatibleSoilTypes: row.soil_types.map(soilName),
    averageYieldKgPerAcre: row.avg_yield_kg_ac,
    durationDays: row.duration_days,
    seedCostPerAcre: row.seed_cost,
    fertilizerCostPerAcre: row.fertilizer_cost,
    pesticideCostPerAcre: row.pesticide_cost,
    irrigationCostPerAcre: row.irrigation_cost,
    laborCostPerAcre: row.labor_cost,
    machineryCostPerAcre: row.machinery_cost,
    postHarvestCostPerAcre: row.post_harvest_cost,
    mandiChargesPerAcre: row.mandi_charges,
    marketPricePerKg: row.market_price_per_kg,
    wastagePercent: row.wastage_percent,
    description: row.description,
  }
})

const correctionRowById = new Map((correctionRows as CorrectionRow[]).map(row => [row.id, row]))
const correctionAliases: Record<string, string> = {
  acidic_soil: 'acidic_soil_cereals',
  extreme_acidity: 'extreme_acidity',
  alkaline_soil: 'alkaline_cotton',
  low_nitrogen: 'low_nitrogen',
  low_phosphorus: 'low_phosphorus',
  low_potassium: 'low_potassium',
}

export const spreadsheetCorrections: SoilCorrection[] = sampleCorrections.map(sample => {
  const row = correctionRowById.get(correctionAliases[sample.problemKey] || sample.problemKey)
  if (!row) return sample
  return {
    ...sample,
    biologicalFix: row.biological_fix,
    physicalFix: row.physical_fix,
    chemicalFix: row.chemical_fix,
    estimatedCostPerAcre: row.estimated_cost_inr,
    minimumDaysBeforeSowing: row.weeks_before_sowing * 7,
  }
})

const pestGroups = pestRows as PestGroup[]
export const spreadsheetPests: PestRisk[] = samplePests.map(sample => {
  const group = pestGroups.find(item => item.crop_id === sample.cropId)
  const row = group?.pests.find(pest => pest.pest_name.toLowerCase() === sample.pestName.toLowerCase())
  if (!row) return sample
  return {
    ...sample,
    pestName: row.pest_name,
    riskLevel: row.risk_level.toLowerCase() as PestRisk['riskLevel'],
    symptoms: row.symptoms,
    biologicalControl: row.biological_control,
    chemicalControl: row.chemical_control,
    economicThreshold: row.economic_threshold,
  }
})

export const spreadsheetGrounding = {
  status: 'research-sheet-grounded',
  sources: ['crop.csv', 'coimbatore_verified_soils.csv', 'chemandbio.csv', 'pest.csv'],
  normalizedRecords: {
    crops: spreadsheetCrops.length,
    corrections: spreadsheetCorrections.length,
    pests: spreadsheetPests.length,
  },
  note: 'Normalized from the project research sheets; confirm field decisions with an agricultural professional.',
}
