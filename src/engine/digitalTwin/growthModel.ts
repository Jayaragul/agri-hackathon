// Growth-cycle maths: turns "sown N days ago" into a day counter, a named
// stage, and a 0-1 maturity value the pixel renderer uses to size plants.
//
// Ported from FieldWatch's `core/growth.js`. Deterministic and pure — no
// randomness, and the only "current time" dependency (`now`) is threaded in
// as a parameter (defaulting to `Date.now()`) instead of read at module
// scope, so every function here is trivially testable with a fixed clock.
//
// This is part of the engine layer: it DECIDES the field's growth state.
// Nothing here calls an AI/LLM — that boundary is intentional.

import type { CropProfile, Field, GrowthStage } from '../../domain/digitalTwin/models'

const DAY_MS = 86_400_000

export interface GrowthState {
  crop: CropProfile
  day: number
  duration: number
  /** 0-1 fraction of the crop's lifecycle elapsed. */
  progress: number
  /** 0-1 visible plant development (see maturityCurve). */
  maturity: number
  stageIndex: number
  stage: GrowthStage
  stages: GrowthStage[]
  daysRemaining: number
  sownDate: Date
  harvestDate: Date
  isOverdue: boolean
  /** True when `dayOverride` was used instead of the field's real sown day. */
  isPreview: boolean
}

/**
 * Computes the field's growth state on a given day.
 *
 * @param field the field being observed
 * @param crop the field's crop profile (its `cropId` resolved by the caller)
 * @param dayOverride preview a specific day (1..duration) instead of the
 *   field's real sown-days-ago — used by the dashboard's growth-day scrubber.
 *   `sownDate`/`harvestDate` stay anchored to the real field regardless, so
 *   previewing never rewrites when the crop was actually planted.
 * @param now reference "now" timestamp (ms epoch), defaults to `Date.now()`
 */
export function computeGrowthState(
  field: Field,
  crop: CropProfile,
  dayOverride: number | null = null,
  now: number = Date.now()
): GrowthState {
  const duration = crop.durationDays

  // Day 1 is the day of sowing, so a field sown today reads "Day 1", not "Day 0".
  const realDay = Math.max(1, field.sownDaysAgo + 1)
  const isPreview = dayOverride != null
  const day = isPreview
    ? Math.max(1, Math.min(duration, Math.round(dayOverride)))
    : realDay
  const progress = Math.min(1, day / duration)

  const stageIndex = crop.stages.findIndex((s) => progress <= s.end)
  const resolvedIndex = stageIndex === -1 ? crop.stages.length - 1 : stageIndex

  return {
    crop,
    day,
    duration,
    progress,
    maturity: maturityCurve(progress),
    stageIndex: resolvedIndex,
    stage: crop.stages[resolvedIndex],
    stages: crop.stages,
    daysRemaining: Math.max(0, duration - day),
    sownDate: new Date(now - field.sownDaysAgo * DAY_MS),
    harvestDate: new Date(now + (duration - realDay) * DAY_MS),
    isOverdue: day > duration,
    isPreview,
  }
}

/**
 * Maps cycle progress (0-1) to visible plant development (0-1).
 *
 * A logistic curve, not a straight line: real crops creep along after sowing,
 * bulk up fast through the vegetative phase, then plateau as they mature
 * rather than growing until the day of harvest. Rescaled so it actually
 * reaches ~0 and ~1 at the ends instead of the raw sigmoid's 0.02/0.98.
 */
export function maturityCurve(progress: number): number {
  const logistic = (x: number) => 1 / (1 + Math.exp(-9 * (x - 0.42)))
  const lo = logistic(0)
  const hi = logistic(1)
  return Math.min(1, Math.max(0, (logistic(progress) - lo) / (hi - lo)))
}

/** Whether harvestable produce should be visible yet for this crop and stage. */
export function hasVisibleProduce(crop: CropProfile, stageIndex: number): boolean {
  return crop.productStage != null && stageIndex >= crop.productStage
}
