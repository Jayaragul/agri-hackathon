// Digital Twin domain types — post-sowing field monitoring.
//
// Ported from the FieldWatch prototype's `data/areas.js` and `data/crops.js`.
// These are pure data shapes only; the deterministic math that turns them into
// growth stages, sensor readings and an Excellence score lives in
// `src/engine/digitalTwin/*` (the engine layer that "decides"). Nothing here
// or in the engine ever calls an AI/LLM — that boundary is load-bearing for
// this project.

/** The six sensor parameters FieldWatch simulates for every field. */
export type SensorParamId =
  | 'moisture'
  | 'ph'
  | 'temperature'
  | 'humidity'
  | 'nitrogen'
  | 'ec'

/** An inclusive [low, high] band for one sensor parameter. */
export type ParamRange = readonly [number, number]

/** Static metadata for one monitored sensor parameter (label, unit, display scale). */
export interface SensorParam {
  id: SensorParamId
  label: string
  short: string
  unit: string
  icon: string
  /** Relative weight in the Excellence score's weighted mean. */
  weight: number
  scaleMin: number
  scaleMax: number
  decimals: number
}

/** One named phase of a crop's lifecycle, e.g. "Tillering". */
export interface GrowthStage {
  name: string
  /** Cumulative fraction (0-1) of the crop's duration at which this stage ends. */
  end: number
}

/** Colour ramp used to draw one crop's pixel-art sprite at varying vigor. */
export interface CropPalette {
  stem: string
  leaf: string
  leafDark: string
  stress: string
  dry: string
  product: string
}

/** How a crop is drawn in the pixel field scene. */
export interface CropArt {
  sprite: string
  rows: number
  perRow: number
  matureH: number
  palette: CropPalette
}

/** Agronomic + lifecycle + rendering profile for one crop. */
export interface CropProfile {
  id: string
  name: string
  icon: string
  family: string
  durationDays: number
  baseYieldPerHa: number
  unit: string
  stages: GrowthStage[]
  /** First stage index at which harvestable produce becomes visible, or null
   *  if the crop never shows visible produce (e.g. underground pods). */
  productStage: number | null
  /** Paddy-style flooded cultivation — standing water instead of dry soil. */
  flooded?: boolean
  perennial?: boolean
  ideal: Record<SensorParamId, ParamRange>
  tolerable: Record<SensorParamId, ParamRange>
  art: CropArt
}

/** A monitored plot of land growing one crop. */
export interface Field {
  id: string
  name: string
  cropId: string
  areaHa: number
  /** Days since sowing, stored as an offset so "Day 15" stays true whenever
   *  the app is opened rather than drifting as real time passes. */
  sownDaysAgo: number
  irrigationCycleDays: number
  /** This field's characteristic offset for each sensor parameter, in units
   *  of the crop's ideal half-range. 0 sits mid-ideal; missing params default
   *  to 0. Positive/negative bias is what makes some fields read Excellent
   *  and others Poor. */
  bias: Partial<Record<SensorParamId, number>>
}

/** A monitoring branch — a named cluster of fields at one real-world location. */
export interface MonitoringArea {
  id: string
  name: string
  taluk: string
  /** [latitude, longitude] in decimal degrees. */
  coords: readonly [number, number]
  fields: Field[]
}
