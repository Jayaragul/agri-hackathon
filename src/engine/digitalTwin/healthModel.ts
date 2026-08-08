// The "how good is this field" score — surfaced in the UI as Excellence %.
//
// Design principle: the score is never an opaque number. Every parameter is
// scored independently against that crop's own ideal/tolerable windows, and
// the UI shows each parameter's score and verdict next to the headline
// figure. A grower should be able to see *why* a field reads 62% and what to
// fix, not just the 62%.
//
// Scoring per parameter:
//
//    inside ideal window            -> 1.00                     (nothing to improve)
//    between ideal and tolerable    -> 1.00 falling to 0.25      (drifting, act soon)
//    just outside tolerable         -> 0.25 falling to 0         (stressed)
//    far outside tolerable          -> 0                         (critical)
//
// The overall score is a weighted mean — moisture and pH carry the most
// weight because they gate nutrient uptake and are the levers a grower can
// actually pull.
//
// Ported from FieldWatch's `core/health.js`. Pure and deterministic: the only
// non-pure dependency (today's sensor readings) is threaded in as a
// parameter, defaulting to `simulateField.currentReadings`.

import type { CropProfile, Field, ParamRange, SensorParam, SensorParamId } from '../../domain/digitalTwin/models'
import { PARAMS, currentReadings } from './simulateField'

const TOLERABLE_FLOOR = 0.25

export interface HealthBand {
  id: string
  label: string
  min: number
  color: string
}

export const BANDS: HealthBand[] = [
  { id: 'excellent', label: 'Excellent', min: 85, color: '#3fd77f' },
  { id: 'good', label: 'Good', min: 70, color: '#9ae63c' },
  { id: 'fair', label: 'Fair', min: 50, color: '#f0b429' },
  { id: 'poor', label: 'Poor', min: 0, color: '#f2545b' },
]

export function bandFor(score: number): HealthBand {
  return BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]
}

export interface ParamScoreResult {
  score: number
  verdict: string
  /** -1 too low, +1 too high, 0 in the ideal window. */
  direction: -1 | 0 | 1
}

/** Scores one reading against its ideal/tolerable windows. */
export function scoreParam(value: number, ideal: ParamRange, tolerable: ParamRange): ParamScoreResult {
  const [idealLo, idealHi] = ideal
  const [tolLo, tolHi] = tolerable

  if (value >= idealLo && value <= idealHi) {
    return { score: 1, verdict: 'Optimal', direction: 0 }
  }

  const tooLow = value < idealLo
  const direction: -1 | 1 = tooLow ? -1 : 1

  // Distance across the ideal->tolerable margin, 0 at the tolerable edge.
  const margin = tooLow ? idealLo - tolLo : tolHi - idealHi
  const distance = tooLow ? idealLo - value : value - idealHi

  if (distance <= margin) {
    const t = margin === 0 ? 0 : 1 - distance / margin
    return {
      score: TOLERABLE_FLOOR + (1 - TOLERABLE_FLOOR) * t,
      verdict: tooLow ? 'Below ideal' : 'Above ideal',
      direction,
    }
  }

  // Beyond tolerable: decay the remaining 0.25 over another half-margin so
  // the score degrades smoothly instead of cliff-edging to zero.
  const overshoot = distance - margin
  const decayOver = Math.max(margin * 0.5, 1e-6)
  const score = Math.max(0, TOLERABLE_FLOOR * (1 - overshoot / decayOver))
  return {
    score,
    verdict: tooLow ? 'Critically low' : 'Critically high',
    direction,
  }
}

export interface ParamAssessment {
  param: SensorParam
  value: number
  score: number
  verdict: string
  direction: -1 | 0 | 1
  ideal: ParamRange
  tolerable: ParamRange
  weight: number
}

export interface HealthAssessment {
  score: number
  band: HealthBand
  readings: Record<SensorParamId, number>
  params: ParamAssessment[]
  worst: ParamAssessment | null
  optimalCount: number
}

/** Full health assessment for a field. */
export function assessField(
  field: Field,
  crop: CropProfile,
  readings: Record<SensorParamId, number> | null = null
): HealthAssessment {
  const values = readings ?? currentReadings(field, crop)

  let weighted = 0
  let weightSum = 0

  const params: ParamAssessment[] = PARAMS.map((param) => {
    const value = values[param.id]
    const ideal = crop.ideal[param.id]
    const tolerable = crop.tolerable[param.id]
    const { score, verdict, direction } = scoreParam(value, ideal, tolerable)

    weighted += score * param.weight
    weightSum += param.weight

    return { param, value, score, verdict, direction, ideal, tolerable, weight: param.weight }
  })

  const score = Math.round((weighted / weightSum) * 100)
  const offTarget = params.filter((p) => p.direction !== 0).sort((a, b) => a.score - b.score)

  return {
    score,
    band: bandFor(score),
    readings: values,
    params,
    worst: offTarget[0] || null,
    optimalCount: params.filter((p) => p.direction === 0).length,
  }
}

export interface FieldHealth extends HealthAssessment {
  field: Field
}

export interface AreaAssessment {
  score: number
  band: HealthBand
  totalArea: number
  fieldScores: FieldHealth[]
  alertCount: number
}

/** Area-weighted mean Excellence across a branch's fields. */
export function assessArea(fields: Array<{ field: Field; crop: CropProfile }>): AreaAssessment {
  const totalArea = fields.reduce((s, f) => s + f.field.areaHa, 0)
  if (!totalArea) {
    return { score: 0, band: bandFor(0), totalArea: 0, fieldScores: [], alertCount: 0 }
  }

  const fieldScores: FieldHealth[] = fields.map(({ field, crop }) => ({
    field,
    ...assessField(field, crop),
  }))
  const score = Math.round(
    fieldScores.reduce((s, fs) => s + fs.score * fs.field.areaHa, 0) / totalArea
  )

  return {
    score,
    band: bandFor(score),
    totalArea,
    fieldScores,
    alertCount: fieldScores.filter((fs) => fs.score < 50).length,
  }
}
