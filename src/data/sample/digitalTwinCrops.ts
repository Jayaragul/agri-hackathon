// Crop profiles for the Coimbatore agro-climatic zone, used by the Digital
// Twin feature's post-sowing field monitoring.
//
// ⚠️ DEMONSTRATION DATASET — research-based approximations of published
// TNAU / TN Dept. of Agriculture guidance, not live measurements. Ported
// from the FieldWatch prototype's `data/crops.js`.
//
// Each crop carries three things:
//
//  1. LIFECYCLE — total duration and named growth stages. Stage boundaries
//     are fractions of the duration, so "Day 15 of 120" resolves to a real
//     stage name. Stage names are crop-specific on purpose (paddy tillers,
//     cotton squares, turmeric bulks rhizomes) — generic "Stage 2" labels
//     would be useless to anyone who actually farms.
//
//  2. AGRONOMIC RANGES — `ideal` and `tolerable` windows per sensor
//     parameter. These drive the Excellence score in
//     `engine/digitalTwin/healthModel.ts`. Inside `ideal` scores full marks;
//     between ideal and tolerable it falls off; outside tolerable it bottoms
//     out.
//
//  3. SPRITE SPEC (`art`) — how the crop is drawn in the pixel field scene.
//     rows/perRow set planting density and matureH the mature plant height
//     in scene pixels; palette drives the healthy->stressed colour ramp.
//
// `productStage` is the first stage index at which harvestable produce
// becomes visible (bolls, cobs, bunches). Before that, the plant is all
// foliage. Validated against `CropProfileMapSchema` at module load so a
// malformed entry fails fast at import time rather than deep in a render.

import type { CropProfile } from '../../domain/digitalTwin/models'
import { CropProfileMapSchema } from '../../domain/digitalTwin/schemas'

const RAW_CROPS: Record<string, CropProfile> = {
  sugarcane: {
    id: 'sugarcane',
    name: 'Sugarcane',
    icon: '🎋',
    family: 'Cash crop',
    durationDays: 330,
    baseYieldPerHa: 100,
    unit: 't',
    stages: [
      { name: 'Germination', end: 0.12 },
      { name: 'Tillering', end: 0.33 },
      { name: 'Grand Growth', end: 0.72 },
      { name: 'Ripening', end: 0.92 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 2,
    ideal: { moisture: [65, 80], ph: [6.0, 7.5], temperature: [24, 34], humidity: [60, 85], nitrogen: [120, 200], ec: [0.3, 1.2] },
    tolerable: { moisture: [50, 92], ph: [5.2, 8.4], temperature: [18, 40], humidity: [45, 95], nitrogen: [80, 260], ec: [0.1, 2.2] },
    art: { sprite: 'sugarcane', rows: 5, perRow: 9, matureH: 48, palette: { stem: '#b6c04a', leaf: '#4fbf5e', leafDark: '#2f8f42', stress: '#b8a63f', dry: '#8d7434', product: '#e0cf72' } },
  },

  rice: {
    id: 'rice',
    name: 'Rice (Paddy)',
    icon: '🌾',
    family: 'Cereal',
    durationDays: 135,
    baseYieldPerHa: 3.8,
    unit: 't',
    stages: [
      { name: 'Nursery', end: 0.16 },
      { name: 'Tillering', end: 0.42 },
      { name: 'Panicle Initiation', end: 0.63 },
      { name: 'Grain Filling', end: 0.87 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 2,
    flooded: true,
    ideal: { moisture: [80, 95], ph: [5.5, 7.0], temperature: [22, 32], humidity: [70, 90], nitrogen: [100, 150], ec: [0.2, 1.0] },
    tolerable: { moisture: [62, 100], ph: [4.6, 8.2], temperature: [16, 38], humidity: [52, 98], nitrogen: [60, 210], ec: [0.05, 1.9] },
    art: { sprite: 'rice', rows: 7, perRow: 20, matureH: 15, palette: { stem: '#8fc44a', leaf: '#63d24f', leafDark: '#37a03d', stress: '#c2b046', dry: '#93803a', product: '#e6d271' } },
  },

  coconut: {
    id: 'coconut',
    name: 'Coconut',
    icon: '🥥',
    family: 'Plantation',
    durationDays: 365,
    baseYieldPerHa: 11000,
    unit: 'nuts',
    stages: [
      { name: 'Leaf Flush', end: 0.2 },
      { name: 'Vegetative', end: 0.45 },
      { name: 'Flowering', end: 0.66 },
      { name: 'Nut Setting', end: 0.88 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    perennial: true,
    ideal: { moisture: [55, 75], ph: [5.5, 7.5], temperature: [25, 34], humidity: [60, 90], nitrogen: [80, 140], ec: [0.3, 1.5] },
    tolerable: { moisture: [38, 88], ph: [4.6, 8.5], temperature: [18, 40], humidity: [42, 98], nitrogen: [45, 200], ec: [0.1, 2.6] },
    // rows/perRow bumped well past the other plantation crops on purpose — a
    // "grove" reading as a dozen trees looked sparse next to a sugarcane or
    // banana block; a proper coconut grove needs to visibly fill the field.
    art: { sprite: 'coconut', rows: 6, perRow: 9, matureH: 60, palette: { stem: '#8a6f4a', leaf: '#3faa52', leafDark: '#26773a', stress: '#a89a44', dry: '#7d6a33', product: '#9a7b4f' } },
  },

  cotton: {
    id: 'cotton',
    name: 'Cotton',
    icon: '☁️',
    family: 'Fiber',
    durationDays: 170,
    baseYieldPerHa: 0.45,
    unit: 't lint',
    stages: [
      { name: 'Emergence', end: 0.14 },
      { name: 'Squaring', end: 0.38 },
      { name: 'Flowering', end: 0.6 },
      { name: 'Boll Development', end: 0.85 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    ideal: { moisture: [50, 70], ph: [6.0, 8.0], temperature: [25, 35], humidity: [50, 75], nitrogen: [90, 150], ec: [0.4, 1.8] },
    tolerable: { moisture: [34, 84], ph: [5.2, 8.8], temperature: [18, 42], humidity: [32, 90], nitrogen: [50, 210], ec: [0.15, 3.0] },
    art: { sprite: 'cotton', rows: 6, perRow: 12, matureH: 23, palette: { stem: '#7a6b3e', leaf: '#48a851', leafDark: '#2c7838', stress: '#b0a044', dry: '#87742f', product: '#f4f7f2' } },
  },

  maize: {
    id: 'maize',
    name: 'Maize',
    icon: '🌽',
    family: 'Cereal',
    durationDays: 110,
    baseYieldPerHa: 5.5,
    unit: 't',
    stages: [
      { name: 'Emergence', end: 0.15 },
      { name: 'Vegetative', end: 0.42 },
      { name: 'Tasselling', end: 0.6 },
      { name: 'Grain Fill', end: 0.86 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    ideal: { moisture: [55, 75], ph: [5.8, 7.2], temperature: [22, 32], humidity: [55, 80], nitrogen: [120, 180], ec: [0.3, 1.2] },
    tolerable: { moisture: [38, 88], ph: [4.9, 8.2], temperature: [15, 38], humidity: [36, 94], nitrogen: [70, 240], ec: [0.1, 2.1] },
    art: { sprite: 'maize', rows: 5, perRow: 10, matureH: 36, palette: { stem: '#93b04a', leaf: '#4eb453', leafDark: '#2e8038', stress: '#b8a541', dry: '#8c7733', product: '#f0c63c' } },
  },

  groundnut: {
    id: 'groundnut',
    name: 'Groundnut',
    icon: '🥜',
    family: 'Oilseed',
    durationDays: 115,
    baseYieldPerHa: 1.4,
    unit: 't',
    stages: [
      { name: 'Emergence', end: 0.15 },
      { name: 'Vegetative', end: 0.4 },
      { name: 'Pegging', end: 0.62 },
      { name: 'Pod Filling', end: 0.87 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    // Pods form underground — nothing harvestable is ever visible above soil.
    productStage: null,
    ideal: { moisture: [50, 70], ph: [6.0, 7.0], temperature: [25, 33], humidity: [55, 80], nitrogen: [60, 100], ec: [0.2, 1.0] },
    tolerable: { moisture: [34, 84], ph: [5.2, 8.0], temperature: [18, 39], humidity: [38, 92], nitrogen: [30, 150], ec: [0.05, 1.8] },
    art: { sprite: 'groundnut', rows: 6, perRow: 16, matureH: 11, palette: { stem: '#6f9a3c', leaf: '#4bb14e', leafDark: '#2f7d36', stress: '#b3a243', dry: '#877330', product: '#c9a227' } },
  },

  turmeric: {
    id: 'turmeric',
    name: 'Turmeric',
    icon: '🟠',
    family: 'Spice',
    durationDays: 240,
    baseYieldPerHa: 6.5,
    unit: 't rhizome',
    stages: [
      { name: 'Sprouting', end: 0.14 },
      { name: 'Tillering', end: 0.38 },
      { name: 'Rhizome Bulking', end: 0.7 },
      { name: 'Maturation', end: 0.9 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: null,
    ideal: { moisture: [65, 85], ph: [5.5, 7.0], temperature: [22, 32], humidity: [70, 90], nitrogen: [100, 160], ec: [0.2, 1.0] },
    tolerable: { moisture: [48, 95], ph: [4.7, 8.0], temperature: [16, 38], humidity: [50, 98], nitrogen: [55, 220], ec: [0.05, 1.8] },
    art: { sprite: 'turmeric', rows: 6, perRow: 13, matureH: 20, palette: { stem: '#7fae42', leaf: '#46ad57', leafDark: '#2b7c3c', stress: '#b5a444', dry: '#8a7632', product: '#e08b1e' } },
  },

  banana: {
    id: 'banana',
    name: 'Banana',
    icon: '🍌',
    family: 'Plantation',
    durationDays: 300,
    baseYieldPerHa: 35,
    unit: 't',
    stages: [
      { name: 'Establishment', end: 0.16 },
      { name: 'Vegetative', end: 0.45 },
      { name: 'Shooting', end: 0.65 },
      { name: 'Bunch Filling', end: 0.9 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    ideal: { moisture: [70, 85], ph: [6.0, 7.5], temperature: [24, 33], humidity: [65, 90], nitrogen: [150, 250], ec: [0.3, 1.2] },
    tolerable: { moisture: [54, 95], ph: [5.0, 8.3], temperature: [17, 39], humidity: [46, 98], nitrogen: [90, 330], ec: [0.1, 2.0] },
    art: { sprite: 'banana', rows: 4, perRow: 5, matureH: 48, palette: { stem: '#5f8a3e', leaf: '#3faa4f', leafDark: '#27793a', stress: '#aa9c43', dry: '#7f6d31', product: '#e8c53a' } },
  },

  onion: {
    id: 'onion',
    name: 'Onion',
    icon: '🧅',
    family: 'Vegetable',
    durationDays: 95,
    baseYieldPerHa: 14,
    unit: 't',
    stages: [
      { name: 'Establishment', end: 0.16 },
      { name: 'Leaf Growth', end: 0.42 },
      { name: 'Bulb Initiation', end: 0.65 },
      { name: 'Bulb Swelling', end: 0.88 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 2,
    ideal: { moisture: [55, 75], ph: [6.0, 7.5], temperature: [18, 30], humidity: [55, 75], nitrogen: [80, 130], ec: [0.3, 1.2] },
    tolerable: { moisture: [38, 88], ph: [5.1, 8.3], temperature: [12, 36], humidity: [38, 90], nitrogen: [45, 185], ec: [0.1, 2.1] },
    art: { sprite: 'onion', rows: 7, perRow: 22, matureH: 13, palette: { stem: '#8fbf46', leaf: '#4fb45f', leafDark: '#317f3d', stress: '#b6a545', dry: '#8a7532', product: '#b06ad4' } },
  },

  tomato: {
    id: 'tomato',
    name: 'Tomato',
    icon: '🍅',
    family: 'Vegetable',
    durationDays: 120,
    baseYieldPerHa: 25,
    unit: 't',
    stages: [
      { name: 'Transplant', end: 0.14 },
      { name: 'Vegetative', end: 0.36 },
      { name: 'Flowering', end: 0.56 },
      { name: 'Fruit Set', end: 0.84 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    ideal: { moisture: [60, 80], ph: [6.0, 7.0], temperature: [20, 30], humidity: [55, 80], nitrogen: [100, 160], ec: [0.4, 1.5] },
    tolerable: { moisture: [42, 92], ph: [5.2, 8.0], temperature: [13, 37], humidity: [38, 94], nitrogen: [55, 220], ec: [0.15, 2.5] },
    art: { sprite: 'tomato', rows: 6, perRow: 12, matureH: 22, palette: { stem: '#6f9a3f', leaf: '#43a84e', leafDark: '#2a7838', stress: '#b0a044', dry: '#867230', product: '#e23c3c' } },
  },

  redgram: {
    id: 'redgram',
    name: 'Redgram',
    icon: '🫘',
    family: 'Pulse',
    durationDays: 165,
    baseYieldPerHa: 0.8,
    unit: 't',
    stages: [
      { name: 'Emergence', end: 0.13 },
      { name: 'Branching', end: 0.4 },
      { name: 'Flowering', end: 0.62 },
      { name: 'Pod Filling', end: 0.87 },
      { name: 'Harvest Ready', end: 1.0 },
    ],
    productStage: 3,
    ideal: { moisture: [45, 65], ph: [6.0, 7.5], temperature: [24, 34], humidity: [50, 75], nitrogen: [40, 80], ec: [0.2, 1.0] },
    tolerable: { moisture: [30, 80], ph: [5.1, 8.3], temperature: [17, 40], humidity: [33, 90], nitrogen: [20, 130], ec: [0.05, 1.9] },
    art: { sprite: 'redgram', rows: 5, perRow: 10, matureH: 27, palette: { stem: '#6b8f3c', leaf: '#41a04c', leafDark: '#297436', stress: '#ab9c42', dry: '#82702f', product: '#c08adb' } },
  },
}

/** Validated at module load so a malformed profile fails fast at import time. */
export const DIGITAL_TWIN_CROPS: Record<string, CropProfile> = CropProfileMapSchema.parse(
  RAW_CROPS
) as Record<string, CropProfile>

export const DIGITAL_TWIN_CROP_LIST: CropProfile[] = Object.values(DIGITAL_TWIN_CROPS)

export function getDigitalTwinCrop(id: string): CropProfile | null {
  return DIGITAL_TWIN_CROPS[id] ?? null
}
