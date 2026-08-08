// The in-season husbandry calendar layered on top of the growth stages —
// when manure goes in and how often the field gets watered. Growth stages
// (growthModel.ts) answer "what is the plant doing"; this answers "what is
// the grower doing to it", which is the other half of "seedling -> watering
// -> manure -> growth -> harvest" a real Tamil Nadu farm timeline needs.
//
// Manure timing is deliberately generic (fractions of the crop's own
// duration) rather than per-crop data, because the split-dose pattern —
// basal at planting, then two top-dressings through active vegetative and
// early reproductive growth — is the TNAU package-of-practice norm across
// nearly every field crop grown here, cereal or cash crop alike.
//
// Ported from FieldWatch's `core/lifecycle.js`.

import type { CropProfile, Field } from '../../domain/digitalTwin/models'
import { computeGrowthState } from './growthModel'

interface ManureScheduleEntry {
  at: number
  label: string
  icon: string
}

const MANURE_SCHEDULE: ManureScheduleEntry[] = [
  { at: 0, label: 'Basal dose', icon: '🌿' },
  { at: 0.3, label: '1st top dressing', icon: '🌿' },
  { at: 0.55, label: '2nd top dressing', icon: '🌿' },
]

export interface ManureEvent extends ManureScheduleEntry {
  day: number
  done: boolean
}

export function manureEvents(field: Field, crop: CropProfile, now: number = Date.now()): ManureEvent[] {
  const growth = computeGrowthState(field, crop, null, now)
  return MANURE_SCHEDULE.map((m) => {
    const day = Math.max(1, Math.round(m.at * growth.duration))
    return { ...m, day, done: growth.day >= day }
  })
}

export interface WateringInfo {
  cycleDays: number
  cyclePct: number
  sinceLast: number
  nextIn: number
  totalEvents: number
}

export function wateringInfo(field: Field, crop: CropProfile, now: number = Date.now()): WateringInfo {
  const growth = computeGrowthState(field, crop, null, now)
  const cycleDays = Math.max(1, field.irrigationCycleDays || 6)
  const sinceLast = (growth.day - 1) % cycleDays
  return {
    cycleDays,
    cyclePct: (cycleDays / growth.duration) * 100,
    sinceLast,
    nextIn: cycleDays - sinceLast,
    totalEvents: Math.floor(growth.duration / cycleDays),
  }
}
