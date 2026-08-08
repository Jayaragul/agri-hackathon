// Sensor readings.
//
// There is no live sensor hardware behind this app, so readings are
// simulated — but deliberately NOT with `Math.random()`. Every value is a
// pure function of (fieldId, parameter, absolute day index, "now"), which
// buys three things a random generator would destroy:
//
//   * A history that is consistent with today's reading, so trend
//     sparklines are real trends rather than noise.
//   * Values that don't jump every time the UI re-renders.
//   * Readings that advance by themselves as real days pass.
//
// Each field's `bias` (see domain models / sample data) positions it within —
// or outside — its crop's ideal window, which is what makes some fields
// Excellent and others Poor.
//
// Ported from FieldWatch's `core/simulate.js`. `Date.now()` is threaded in as
// an optional `now` parameter (default `Date.now()`) rather than read at
// module scope, so the whole module is deterministic and testable with a
// fixed clock.

import type { CropProfile, Field, SensorParam, SensorParamId } from '../../domain/digitalTwin/models'

export const PARAMS: SensorParam[] = [
  { id: 'moisture', label: 'Soil Moisture', short: 'Moisture', unit: '%', icon: '💧', weight: 1.4, scaleMin: 0, scaleMax: 100, decimals: 0 },
  { id: 'ph', label: 'Soil pH', short: 'pH', unit: '', icon: '⚗️', weight: 1.3, scaleMin: 3.5, scaleMax: 9.5, decimals: 1 },
  { id: 'temperature', label: 'Temperature', short: 'Temp', unit: '°C', icon: '🌡️', weight: 1.0, scaleMin: 8, scaleMax: 46, decimals: 1 },
  { id: 'humidity', label: 'Humidity', short: 'Humidity', unit: '%', icon: '☁️', weight: 0.8, scaleMin: 15, scaleMax: 100, decimals: 0 },
  { id: 'nitrogen', label: 'Nitrogen', short: 'Nitrogen', unit: 'kg/ha', icon: '🧪', weight: 1.1, scaleMin: 0, scaleMax: 300, decimals: 0 },
  { id: 'ec', label: 'Salinity (EC)', short: 'Salinity', unit: 'dS/m', icon: '⚡', weight: 0.7, scaleMin: 0, scaleMax: 3.2, decimals: 2 },
]

export const PARAM_BY_ID: Record<SensorParamId, SensorParam> = Object.fromEntries(
  PARAMS.map((p) => [p.id, p])
) as Record<SensorParamId, SensorParam>

/** Absolute day number — increments once per real calendar day. */
export function todayIndex(now: number = Date.now()): number {
  return Math.floor(now / 86_400_000)
}

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic 0-1 value for a (seed, step) pair. */
function noise(seed: number, step: number): number {
  let h = Math.imul(seed ^ Math.imul(step, 374761393), 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smoothly interpolated noise, so day-to-day drift looks organic, not jittery. */
function smoothNoise(seed: number, t: number): number {
  const i = Math.floor(t)
  const f = t - i
  const a = noise(seed, i)
  const b = noise(seed, i + 1)
  const eased = f * f * (3 - 2 * f) // smoothstep
  return a + (b - a) * eased
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/**
 * Reading for one parameter of one field on a given absolute day.
 *
 * @param dayIndex absolute day number (see todayIndex)
 * @param now reference "now" timestamp (ms epoch) for the intraday swing;
 *   defaults to `Date.now()`.
 */
export function reading(
  field: Field,
  crop: CropProfile,
  paramId: SensorParamId,
  dayIndex: number,
  now: number = Date.now()
): number {
  const param = PARAM_BY_ID[paramId]
  const [lo, hi] = crop.ideal[paramId]
  const mid = (lo + hi) / 2
  const half = (hi - lo) / 2 || 1

  const seed = hashString(`${field.id}:${paramId}`)
  const bias = field.bias[paramId] ?? 0

  // Centre of this field's distribution, pushed off mid-ideal by its bias.
  let value = mid + bias * half

  // Slow seasonal drift plus finer day-to-day variation.
  value += (smoothNoise(seed, dayIndex / 9) - 0.5) * half * 0.55
  value += (smoothNoise(seed + 7717, dayIndex / 2.5) - 0.5) * half * 0.28

  // Soil moisture is dominated by the irrigation cycle: a sharp rise on the
  // day water is applied, then exponential dry-down until the next event.
  if (paramId === 'moisture') {
    const cycle = Math.max(1, field.irrigationCycleDays || 6)
    const phase = ((dayIndex % cycle) + cycle) % cycle
    value += half * (0.9 * Math.exp(-phase / (cycle * 0.42)) - 0.34)
  }

  // Temperature and humidity also swing with time of day, which makes the
  // live readout feel current rather than a daily average.
  if (paramId === 'temperature' || paramId === 'humidity') {
    const hourFrac = (now % 86_400_000) / 86_400_000
    const diurnal = Math.sin((hourFrac - 0.28) * Math.PI * 2)
    value += half * diurnal * (paramId === 'temperature' ? 0.34 : -0.28)
  }

  return clamp(round(value, param.decimals), param.scaleMin, param.scaleMax)
}

/** Current readings for every parameter, keyed by param id. */
export function currentReadings(
  field: Field,
  crop: CropProfile,
  dayIndex: number = todayIndex(),
  now: number = Date.now()
): Record<SensorParamId, number> {
  const out = {} as Record<SensorParamId, number>
  PARAMS.forEach((p) => {
    out[p.id] = reading(field, crop, p.id, dayIndex, now)
  })
  return out
}

/** Last `days` readings for one parameter, oldest first — for sparklines. */
export function history(
  field: Field,
  crop: CropProfile,
  paramId: SensorParamId,
  days: number = 21,
  dayIndex: number = todayIndex(),
  now: number = Date.now()
): number[] {
  const out: number[] = []
  for (let i = days - 1; i >= 0; i--) out.push(reading(field, crop, paramId, dayIndex - i, now))
  return out
}
