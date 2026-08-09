// Monitoring areas ("branches") and the fields under each, across Coimbatore
// district, for the Digital Twin feature's post-sowing field monitoring.
//
// ⚠️ DEMONSTRATION DATASET. Ported from the FieldWatch prototype's
// `data/areas.js`. Validated against `MonitoringAreaListSchema` at module
// load so a malformed entry fails fast at import time rather than deep in a
// render.
//
// Field seed data notes:
//
//  sownDaysAgo — how many days ago the crop went in. Stored as an OFFSET
//    rather than a fixed date so "Day 15" stays true whenever the app is
//    opened, instead of silently drifting into "Day 400" over time.
//    `engine/digitalTwin/growthModel.ts` turns this into the day counter and
//    the current growth stage.
//
//  bias — this field's characteristic offset for each sensor parameter,
//    expressed in units of the crop's ideal half-range. 0 sits mid-ideal;
//    -0.8 means the field consistently runs near the dry/low edge; +1.4
//    means it runs outside the ideal window entirely. This is what makes
//    some fields Excellent and others Poor, and it's what
//    `engine/digitalTwin/simulateField.ts` builds its readings around. Any
//    parameter left out defaults to 0 (comfortably mid-range).
//
//  irrigationCycleDays — spacing of irrigation events, which drives the
//    sawtooth in the soil-moisture trace.
//
//  coords — [lat, lon] in decimal degrees, the branch's real-world location.
//    Sourced from published gazetteer/OSM coordinates for each village, not
//    placed by eye — this is what lets the district map position every
//    branch true-to-scale and report a real distance from Coimbatore city
//    centre (11.0168, 76.9558) instead of an arbitrary layout.

import type { MonitoringArea } from '../../domain/digitalTwin/models'
import { MonitoringAreaListSchema } from '../../domain/digitalTwin/schemas'

const RAW_AREAS: MonitoringArea[] = [
  {
    id: 'singanallur',
    name: 'Singanallur Branch',
    taluk: 'Coimbatore South',
    coords: [11.0042, 77.0243],
    fields: [
      { id: 'sgn-1', name: 'Singanallur Block A', cropId: 'sugarcane', areaHa: 3.2, sownDaysAgo: 96, irrigationCycleDays: 6, bias: { moisture: 0.2, ph: 0.1, nitrogen: 0.35 } },
      { id: 'sgn-2', name: 'Singanallur Block B', cropId: 'maize', areaHa: 1.8, sownDaysAgo: 15, irrigationCycleDays: 5, bias: { moisture: -0.25, temperature: 0.4 } },
      { id: 'sgn-3', name: 'Kaanuvai Onion Beds', cropId: 'onion', areaHa: 1.1, sownDaysAgo: 1, irrigationCycleDays: 3, bias: { moisture: 0.3, ph: 0.2 } },
      { id: 'sgn-4', name: 'Irugur Road Cotton', cropId: 'cotton', areaHa: 2.6, sownDaysAgo: 58, irrigationCycleDays: 9, bias: { moisture: -1.35, humidity: -0.9, ec: 0.8 } },
    ],
  },
  {
    id: 'peelamedu',
    name: 'Peelamedu Branch',
    taluk: 'Coimbatore North',
    coords: [11.0268, 77.0212],
    fields: [
      { id: 'plm-1', name: 'Peelamedu Tomato House', cropId: 'tomato', areaHa: 0.8, sownDaysAgo: 62, irrigationCycleDays: 2, bias: { moisture: 0.15, humidity: 0.3, nitrogen: 0.2 } },
      { id: 'plm-2', name: 'Hope College Plot', cropId: 'groundnut', areaHa: 2.2, sownDaysAgo: 41, irrigationCycleDays: 8, bias: { moisture: -0.4 } },
      { id: 'plm-3', name: 'Avinashi Road Maize', cropId: 'maize', areaHa: 3.4, sownDaysAgo: 88, irrigationCycleDays: 6, bias: { nitrogen: -1.2, moisture: -0.5 } },
    ],
  },
]

/** Validated at module load so a malformed area/field fails fast at import time. */
export const DIGITAL_TWIN_AREAS: MonitoringArea[] = MonitoringAreaListSchema.parse(
  RAW_AREAS
) as MonitoringArea[]

export function getDigitalTwinArea(id: string): MonitoringArea | null {
  return DIGITAL_TWIN_AREAS.find((a) => a.id === id) || null
}

export function getDigitalTwinField(
  fieldId: string
): { area: MonitoringArea; field: MonitoringArea['fields'][number] } | null {
  for (const area of DIGITAL_TWIN_AREAS) {
    const field = area.fields.find((f) => f.id === fieldId)
    if (field) return { area, field }
  }
  return null
}
