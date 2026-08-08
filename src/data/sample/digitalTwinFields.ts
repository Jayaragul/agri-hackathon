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
  {
    id: 'saravanampatti',
    name: 'Saravanampatti Branch',
    taluk: 'Coimbatore North',
    coords: [11.0764, 77.003],
    fields: [
      { id: 'srv-1', name: 'Saravanampatti Turmeric', cropId: 'turmeric', areaHa: 2.9, sownDaysAgo: 132, irrigationCycleDays: 5, bias: { moisture: 0.25, humidity: 0.4 } },
      { id: 'srv-2', name: 'Kalapatti Banana Grove', cropId: 'banana', areaHa: 1.7, sownDaysAgo: 205, irrigationCycleDays: 3, bias: { moisture: 0.1, nitrogen: 0.3 } },
      { id: 'srv-3', name: 'Vilankurichi Redgram', cropId: 'redgram', areaHa: 4.1, sownDaysAgo: 74, irrigationCycleDays: 14, bias: { moisture: -0.95, humidity: -0.7 } },
    ],
  },
  {
    id: 'sulur',
    name: 'Sulur Branch',
    taluk: 'Sulur',
    coords: [11.0253, 77.1247],
    fields: [
      { id: 'sul-1', name: 'Sulur Cane Estate', cropId: 'sugarcane', areaHa: 7.7, sownDaysAgo: 198, irrigationCycleDays: 7, bias: { moisture: 0.3, nitrogen: 0.5, ph: -0.2 } },
      { id: 'sul-2', name: 'Sulur Cotton North', cropId: 'cotton', areaHa: 4.8, sownDaysAgo: 101, irrigationCycleDays: 10, bias: { moisture: -0.3, ec: 0.5 } },
      { id: 'sul-3', name: 'Kannampalayam Paddy', cropId: 'rice', areaHa: 3.5, sownDaysAgo: 47, irrigationCycleDays: 2, bias: { moisture: 0.4, humidity: 0.35 } },
    ],
  },
  {
    id: 'pollachi',
    name: 'Pollachi Branch',
    taluk: 'Pollachi',
    coords: [10.6573, 77.0107],
    fields: [
      { id: 'pol-1', name: 'Pollachi Coconut Grove', cropId: 'coconut', areaHa: 6.4, sownDaysAgo: 288, irrigationCycleDays: 4, bias: { moisture: 0.2, humidity: 0.45, nitrogen: 0.3 } },
      { id: 'pol-2', name: 'Pollachi Turmeric East', cropId: 'turmeric', areaHa: 3.1, sownDaysAgo: 62, irrigationCycleDays: 5, bias: { moisture: 0.3, ph: -0.3 } },
      { id: 'pol-3', name: 'Anaimalai Banana', cropId: 'banana', areaHa: 2.4, sownDaysAgo: 156, irrigationCycleDays: 3, bias: { moisture: 0.25, humidity: 0.5 } },
      { id: 'pol-4', name: 'Kottur Groundnut', cropId: 'groundnut', areaHa: 2.0, sownDaysAgo: 108, irrigationCycleDays: 9, bias: { moisture: -0.5, ph: 0.3 } },
    ],
  },
  {
    id: 'mettupalayam',
    name: 'Mettupalayam Branch',
    taluk: 'Mettupalayam',
    coords: [11.2997, 76.9349],
    fields: [
      { id: 'met-1', name: 'Mettupalayam Tomato', cropId: 'tomato', areaHa: 1.4, sownDaysAgo: 29, irrigationCycleDays: 3, bias: { moisture: 0.1, temperature: -0.3 } },
      { id: 'met-2', name: 'Bhavani Bank Paddy', cropId: 'rice', areaHa: 5.2, sownDaysAgo: 112, irrigationCycleDays: 2, bias: { moisture: 0.35 } },
      { id: 'met-3', name: 'Sirumugai Banana', cropId: 'banana', areaHa: 2.8, sownDaysAgo: 240, irrigationCycleDays: 4, bias: { nitrogen: -0.8, moisture: -0.4 } },
    ],
  },
  {
    id: 'annur',
    name: 'Annur Branch',
    taluk: 'Annur',
    coords: [11.23, 77.1],
    fields: [
      { id: 'ann-1', name: 'Annur Cotton Estate', cropId: 'cotton', areaHa: 6.6, sownDaysAgo: 143, irrigationCycleDays: 16, bias: { moisture: -1.6, humidity: -1.1, ec: 1.2, nitrogen: -0.7 } },
      { id: 'ann-2', name: 'Karumathampatti Maize', cropId: 'maize', areaHa: 3.9, sownDaysAgo: 55, irrigationCycleDays: 7, bias: { moisture: -0.2 } },
      { id: 'ann-3', name: 'Annur Redgram', cropId: 'redgram', areaHa: 4.4, sownDaysAgo: 22, irrigationCycleDays: 13, bias: { moisture: -0.6 } },
    ],
  },
  {
    id: 'kinathukadavu',
    name: 'Kinathukadavu Branch',
    taluk: 'Kinathukadavu',
    coords: [10.8225, 77.0161],
    fields: [
      { id: 'kin-1', name: 'Kinathukadavu Groundnut', cropId: 'groundnut', areaHa: 5.2, sownDaysAgo: 34, irrigationCycleDays: 8, bias: { moisture: -0.25, ph: 0.15 } },
      { id: 'kin-2', name: 'Kinathukadavu Maize', cropId: 'maize', areaHa: 4.4, sownDaysAgo: 71, irrigationCycleDays: 6, bias: { nitrogen: 0.3 } },
      { id: 'kin-3', name: 'Malumichampatti Onion', cropId: 'onion', areaHa: 1.6, sownDaysAgo: 49, irrigationCycleDays: 4, bias: { moisture: 0.2 } },
    ],
  },
  {
    id: 'thondamuthur',
    name: 'Thondamuthur Branch',
    taluk: 'Thondamuthur',
    coords: [10.9899, 76.8409],
    fields: [
      { id: 'thn-1', name: 'Thondamuthur Paddy', cropId: 'rice', areaHa: 6.2, sownDaysAgo: 68, irrigationCycleDays: 2, bias: { moisture: 0.45, humidity: 0.4, ph: -0.2 } },
      { id: 'thn-2', name: 'Narasipuram Late Paddy', cropId: 'rice', areaHa: 3.3, sownDaysAgo: 12, irrigationCycleDays: 11, bias: { moisture: -1.5, humidity: -0.8 } },
      { id: 'thn-3', name: 'Alandurai Sugarcane', cropId: 'sugarcane', areaHa: 4.9, sownDaysAgo: 262, irrigationCycleDays: 6, bias: { moisture: 0.2, nitrogen: 0.4 } },
    ],
  },
  {
    id: 'madukkarai',
    name: 'Madukkarai Branch',
    taluk: 'Madukkarai',
    coords: [10.913, 76.952],
    fields: [
      { id: 'mad-1', name: 'Madukkarai Redgram', cropId: 'redgram', areaHa: 4.0, sownDaysAgo: 97, irrigationCycleDays: 15, bias: { moisture: -0.85, ec: 0.6 } },
      { id: 'mad-2', name: 'Madukkarai Onion Beds', cropId: 'onion', areaHa: 1.9, sownDaysAgo: 78, irrigationCycleDays: 4, bias: { moisture: 0.15, nitrogen: 0.2 } },
      { id: 'mad-3', name: 'Walayar Road Cotton', cropId: 'cotton', areaHa: 3.7, sownDaysAgo: 6, irrigationCycleDays: 9, bias: { temperature: 0.5, moisture: -0.35 } },
    ],
  },
  {
    id: 'vadavalli',
    name: 'Vadavalli Branch',
    taluk: 'Coimbatore West',
    coords: [11.0247, 76.898],
    fields: [
      { id: 'vad-1', name: 'Vadavalli Vegetable Beds', cropId: 'tomato', areaHa: 1.2, sownDaysAgo: 103, irrigationCycleDays: 2, bias: { moisture: 0.2, humidity: 0.25 } },
      { id: 'vad-2', name: 'Perur Turmeric', cropId: 'turmeric', areaHa: 2.3, sownDaysAgo: 187, irrigationCycleDays: 5, bias: { moisture: 0.15 } },
      { id: 'vad-3', name: 'Somayampalayam Onion', cropId: 'onion', areaHa: 1.5, sownDaysAgo: 88, irrigationCycleDays: 4, bias: { ph: 0.9, moisture: -0.5 } },
    ],
  },
  {
    id: 'kurichi',
    name: 'Kurichi Branch',
    taluk: 'Coimbatore South',
    coords: [10.96, 77.01],
    fields: [
      { id: 'kur-1', name: 'Kurichi Cane Block', cropId: 'sugarcane', areaHa: 5.5, sownDaysAgo: 41, irrigationCycleDays: 7, bias: { moisture: 0.1, ec: 0.7 } },
      { id: 'kur-2', name: 'Sundarapuram Coconut', cropId: 'coconut', areaHa: 4.2, sownDaysAgo: 330, irrigationCycleDays: 5, bias: { moisture: -0.3, nitrogen: -0.4 } },
      { id: 'kur-3', name: 'Chettipalayam Groundnut', cropId: 'groundnut', areaHa: 3.0, sownDaysAgo: 63, irrigationCycleDays: 8, bias: { moisture: -0.2 } },
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
