import { z } from 'zod'

export const FarmProfileSchema = z.object({
  ph: z.number().min(0, "pH must be at least 0").max(14, "pH must be at most 14"),
  nitrogenKgPerAcre: z.number().min(0, "Nitrogen cannot be negative").max(500, "Nitrogen level too high"),
  phosphorusKgPerAcre: z.number().min(0, "Phosphorus cannot be negative").max(500, "Phosphorus level too high"),
  potassiumKgPerAcre: z.number().min(0, "Potassium cannot be negative").max(500, "Potassium level too high"),
  soilType: z.string().min(1, "Soil type is required"),
  region: z.string().min(1, "Region is required"),
  acres: z.number().positive("Acres must be greater than 0"),
  currentMonth: z.number().int().min(1).max(12),
})

export const DatasetMetadataSchema = z.object({
  name: z.string(),
  version: z.string(),
  region: z.string(),
  sourceType: z.enum(['demo', 'expert-reviewed', 'official', 'research']),
  lastUpdated: z.string(),
  limitations: z.array(z.string()),
})

export const CropSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string().default('🌱'),
  category: z.string().default('Food Crop'),
  season: z.array(z.string()),
  sowingMonths: z.array(z.number().int().min(1).max(12)),
  idealPhMin: z.number(),
  idealPhMax: z.number(),
  nitrogenRequired: z.number().min(0),
  phosphorusRequired: z.number().min(0),
  potassiumRequired: z.number().min(0),
  compatibleSoilTypes: z.array(z.string()),
  supportedRegions: z.array(z.string()),
  averageYieldKgPerAcre: z.number().positive(),
  durationDays: z.number().int().positive(),
  seedCostPerAcre: z.number().min(0),
  fertilizerCostPerAcre: z.number().min(0),
  pesticideCostPerAcre: z.number().min(0),
  irrigationCostPerAcre: z.number().min(0),
  laborCostPerAcre: z.number().min(0),
  machineryCostPerAcre: z.number().min(0),
  postHarvestCostPerAcre: z.number().min(0),
  mandiChargesPerAcre: z.number().min(0),
  marketPricePerKg: z.number().positive(),
  wastagePercent: z.number().min(0).max(100),
  description: z.string().default(''),
})

export const SoilTypeSchema = z.object({
  series: z.string(),
  symbol: z.string(),
  phRange: z.string(),
  texture: z.string(),
  locations: z.array(z.string()),
  suitableCrops: z.array(z.string()),
  productivity: z.string(),
  characteristics: z.string(),
})

export const SoilCorrectionSchema = z.object({
  id: z.string(),
  problemKey: z.string(),
  displayName: z.string(),
  biologicalFix: z.string(),
  physicalFix: z.string().optional(),
  chemicalFix: z.string().optional(),
  estimatedCostPerAcre: z.number().min(0),
  minimumDaysBeforeSowing: z.number().int().min(0),
  safetyNote: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
})

export const PestRiskSchema = z.object({
  id: z.string(),
  cropId: z.string(),
  pestName: z.string(),
  pestEmoji: z.string().default('🐛'),
  riskLevel: z.enum(['low', 'medium', 'high']),
  symptoms: z.string().default(''),
  biologicalControl: z.string(),
  chemicalControl: z.string().optional(),
  economicThreshold: z.string().default('Consult local extension officer'),
})
