import { create } from 'zustand'
import type { Field, MonitoringArea } from '../domain/digitalTwin/models'
import { computeGrowthState, type GrowthState } from '../engine/digitalTwin/growthModel'
import { assessField, type HealthAssessment } from '../engine/digitalTwin/healthModel'
import { DIGITAL_TWIN_AREAS, getDigitalTwinArea } from '../data/sample/digitalTwinFields'
import { getDigitalTwinCrop } from '../data/sample/digitalTwinCrops'

/** The engine's decision for the currently selected field — growth stage and
 *  Excellence score, recomputed by the store any time the selection, preview
 *  day, or simulated clock changes. Purely derived from
 *  `engine/digitalTwin/*`; the store never computes this itself. */
export interface DigitalTwinSnapshot {
  area: MonitoringArea
  field: Field
  growth: GrowthState
  health: HealthAssessment
}

function buildSnapshot(
  areaId: string | null,
  fieldId: string | null,
  dayOverride: number | null,
  now: number
): DigitalTwinSnapshot | null {
  if (!areaId) return null
  const area = getDigitalTwinArea(areaId)
  if (!area) return null
  const field = area.fields.find((f) => f.id === fieldId) ?? area.fields[0]
  if (!field) return null
  const crop = getDigitalTwinCrop(field.cropId)
  if (!crop) return null

  const growth = computeGrowthState(field, crop, dayOverride, now)
  const health = assessField(field, crop)
  return { area, field, growth, health }
}

interface DigitalTwinState {
  areas: MonitoringArea[]

  selectedAreaId: string | null
  selectedFieldId: string | null

  /** Growth-day scrubber preview (1..crop duration), null = real sown day. */
  dayOverride: number | null
  /** Climate/season preview id (see pixel scene SEASONS), null = real month. */
  seasonOverride: string | null

  /** The simulation's "now", advanced by `advanceDay` — lets the twin be
   *  ticked forward without depending on the wall clock. */
  simulatedNow: number

  /** Engine output for the current selection; null until an area is picked. */
  snapshot: DigitalTwinSnapshot | null

  selectArea: (areaId: string) => void
  selectField: (areaId: string, fieldId: string) => void
  previewDay: (day: number | null) => void
  previewSeason: (seasonId: string | null) => void
  resetPreview: () => void
  /** Advance the simulated clock by `days` (default 1) and re-run the engine. */
  advanceDay: (days?: number) => void
  clearSelection: () => void
}

export const useDigitalTwinStore = create<DigitalTwinState>((set, get) => ({
  areas: DIGITAL_TWIN_AREAS,

  selectedAreaId: null,
  selectedFieldId: null,
  dayOverride: null,
  seasonOverride: null,
  simulatedNow: Date.now(),
  snapshot: null,

  selectArea: (areaId) => {
    const area = getDigitalTwinArea(areaId)
    const fieldId = area?.fields[0]?.id ?? null
    const { simulatedNow } = get()
    set({
      selectedAreaId: areaId,
      selectedFieldId: fieldId,
      dayOverride: null,
      seasonOverride: null,
      snapshot: buildSnapshot(areaId, fieldId, null, simulatedNow),
    })
  },

  selectField: (areaId, fieldId) => {
    const { simulatedNow } = get()
    set({
      selectedAreaId: areaId,
      selectedFieldId: fieldId,
      dayOverride: null,
      seasonOverride: null,
      snapshot: buildSnapshot(areaId, fieldId, null, simulatedNow),
    })
  },

  previewDay: (day) => {
    const { selectedAreaId, selectedFieldId, simulatedNow } = get()
    set({
      dayOverride: day,
      snapshot: buildSnapshot(selectedAreaId, selectedFieldId, day, simulatedNow),
    })
  },

  previewSeason: (seasonId) => set({ seasonOverride: seasonId }),

  resetPreview: () => {
    const { selectedAreaId, selectedFieldId, simulatedNow } = get()
    set({
      dayOverride: null,
      seasonOverride: null,
      snapshot: buildSnapshot(selectedAreaId, selectedFieldId, null, simulatedNow),
    })
  },

  advanceDay: (days = 1) => {
    const { selectedAreaId, selectedFieldId, dayOverride, simulatedNow } = get()
    const nextNow = simulatedNow + days * 86_400_000
    set({
      simulatedNow: nextNow,
      snapshot: buildSnapshot(selectedAreaId, selectedFieldId, dayOverride, nextNow),
    })
  },

  clearSelection: () =>
    set({
      selectedAreaId: null,
      selectedFieldId: null,
      dayOverride: null,
      seasonOverride: null,
      snapshot: null,
    }),
}))
