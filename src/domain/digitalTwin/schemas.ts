import { z } from 'zod'

export const SensorParamIdSchema = z.enum([
  'moisture',
  'ph',
  'temperature',
  'humidity',
  'nitrogen',
  'ec',
])

export const ParamRangeSchema = z.tuple([z.number(), z.number()])

export const SensorParamSchema = z.object({
  id: SensorParamIdSchema,
  label: z.string(),
  short: z.string(),
  unit: z.string(),
  icon: z.string(),
  weight: z.number().positive(),
  scaleMin: z.number(),
  scaleMax: z.number(),
  decimals: z.number().int().min(0),
})

export const GrowthStageSchema = z.object({
  name: z.string(),
  end: z.number().min(0).max(1),
})

export const CropPaletteSchema = z.object({
  stem: z.string(),
  leaf: z.string(),
  leafDark: z.string(),
  stress: z.string(),
  dry: z.string(),
  product: z.string(),
})

export const CropArtSchema = z.object({
  sprite: z.string(),
  rows: z.number().int().positive(),
  perRow: z.number().int().positive(),
  matureH: z.number().positive(),
  palette: CropPaletteSchema,
})

/** A range keyed by every sensor parameter — the full agronomic window a crop
 *  profile defines for `ideal` and `tolerable`. */
export const ParamRangeMapSchema = z.object({
  moisture: ParamRangeSchema,
  ph: ParamRangeSchema,
  temperature: ParamRangeSchema,
  humidity: ParamRangeSchema,
  nitrogen: ParamRangeSchema,
  ec: ParamRangeSchema,
})

export const CropProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  icon: z.string(),
  family: z.string(),
  durationDays: z.number().int().positive(),
  baseYieldPerHa: z.number().positive(),
  unit: z.string(),
  stages: z.array(GrowthStageSchema).min(1),
  productStage: z.number().int().min(0).nullable(),
  flooded: z.boolean().optional(),
  perennial: z.boolean().optional(),
  ideal: ParamRangeMapSchema,
  tolerable: ParamRangeMapSchema,
  art: CropArtSchema,
})

export const FieldBiasSchema = z
  .object({
    moisture: z.number(),
    ph: z.number(),
    temperature: z.number(),
    humidity: z.number(),
    nitrogen: z.number(),
    ec: z.number(),
  })
  .partial()

export const FieldSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cropId: z.string().min(1),
  areaHa: z.number().positive(),
  sownDaysAgo: z.number().int().min(0),
  irrigationCycleDays: z.number().positive(),
  bias: FieldBiasSchema,
})

export const MonitoringAreaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  taluk: z.string().min(1),
  coords: z.tuple([z.number(), z.number()]),
  fields: z.array(FieldSchema).min(1),
})

export const CropProfileMapSchema = z.record(z.string(), CropProfileSchema)
export const MonitoringAreaListSchema = z.array(MonitoringAreaSchema).min(1)
