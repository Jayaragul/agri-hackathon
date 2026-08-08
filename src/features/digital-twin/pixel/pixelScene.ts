// The pixel-art field scene.
//
// Renders at a fixed 240x135 backing resolution and lets CSS upscale it with
// `image-rendering: pixelated`, so pixels stay crisp at any panel size
// without integer-scaling gymnastics in layout.
//
// The scene is not decoration — every layer is driven by the engine's
// output, never computed here:
//
//   growth stage   -> plant height and structure (sprout vs full canopy)
//   Excellence %   -> foliage color, leaf droop, and how many plants are
//                    missing (a poor field has visible bare gaps in the stand)
//   soil moisture  -> soil tint, from pale dry dust to dark wet earth
//   flooded crops  -> standing water with animated shimmer (paddy)
//   time of day    -> sky palette, sun/moon position, star field at night
//
// This module owns rendering only — growth stage and Excellence score are
// computed once by `engine/digitalTwin/*` and handed in via `setField`.
// Nothing here re-derives or overrides that decision; it only visualizes it.
//
// It runs at ~24fps on purpose: a lower, slightly steppy cadence reads as
// deliberate pixel animation, where 60fps smoothness reads as a cheap CSS
// effect.
//
// Ported from FieldWatch's `pixel/pixelScene.js`.

import type { CropProfile, Field } from '../../../domain/digitalTwin/models'
import type { HealthAssessment } from '../../../engine/digitalTwin/healthModel'
import { computeGrowthState, hasVisibleProduce } from '../../../engine/digitalTwin/growthModel'
import { drawPlant, paintFarmer, foliageColors, mix, shade, type Painter, type FarmerMoodId } from './sprites'

const W = 240
const H = 135
const HORIZON = 74
const FPS = 24

// ---------------------------------------------------------------------------
// Sky palettes by time of day. Each is [zenith, mid, horizon].
// ---------------------------------------------------------------------------
interface SkyPalette {
  sky: [string, string, string]
  sun: string
  light: number
  stars: boolean
}

interface SkyWithPhase extends SkyPalette {
  phase: string
}

const SKIES: Record<'night' | 'dawn' | 'day' | 'dusk', SkyPalette> = {
  night: { sky: ['#0a1030', '#131c44', '#25315e'], sun: '#dfe6f5', light: 0.3, stars: true },
  dawn: { sky: ['#2b3f77', '#7d6191', '#e59a72'], sun: '#ffd9a0', light: 0.62, stars: false },
  day: { sky: ['#3d86c6', '#63a6d8', '#a8cfe6'], sun: '#fff4c4', light: 1, stars: false },
  dusk: { sky: ['#243a6b', '#8a5c86', '#e08a5c'], sun: '#ffc98a', light: 0.6, stars: false },
}

function skyForHour(hour: number): SkyWithPhase {
  if (hour < 5 || hour >= 20) return { ...SKIES.night, phase: 'Night' }
  if (hour < 7.5) return { ...SKIES.dawn, phase: 'Dawn' }
  if (hour < 17.5) return { ...SKIES.day, phase: 'Day' }
  return { ...SKIES.dusk, phase: 'Dusk' }
}

// ---------------------------------------------------------------------------
// Season, from the real calendar month — Coimbatore sits in the Palakkad Gap,
// the corridor that funnels the SW monsoon straight through the district,
// which is literally why the region's wind farms are sited here. That makes
// Jun-Sep the genuine high-wind season, not just "monsoon". The NE monsoon
// (Oct-Nov) is what actually delivers most of Coimbatore's rain; Dec-Feb runs
// cool and calm; Mar-May is the hot, hazy dry season.
// ---------------------------------------------------------------------------
// rain is a per-day PROBABILITY, not "how wet it looks once it happens" —
// dry seasons sit near zero so they practically never rain, on purpose.
export interface Season {
  id: string
  name: string
  wind: number
  rain: number
  haze: number
}

export const SEASONS: Record<'winter' | 'summer' | 'windy' | 'monsoon', Season> = {
  winter: { id: 'winter', name: 'Winter', wind: 0.28, rain: 0.05, haze: 0 },
  summer: { id: 'summer', name: 'Summer', wind: 0.32, rain: 0.02, haze: 0.55 },
  windy: { id: 'windy', name: 'SW Monsoon · High Wind', wind: 1, rain: 0.22, haze: 0 },
  monsoon: { id: 'monsoon', name: 'NE Monsoon', wind: 0.55, rain: 0.4, haze: 0 },
}

function seasonForMonth(month: number): Season {
  if (month === 11 || month === 0 || month === 1) return SEASONS.winter
  if (month >= 2 && month <= 4) return SEASONS.summer
  if (month >= 5 && month <= 8) return SEASONS.windy
  return SEASONS.monsoon // 9, 10
}

/** Stable per-day roll (not per-frame) for "is it raining somewhere in the
 *  district today", weighted by the season's rain likelihood. */
function seasonRainToday(season: Season, now: number): boolean {
  const dayIndex = Math.floor(now / 86_400_000)
  return rngFrom(dayIndex + 90210)() < season.rain
}

/** Whether it's actually raining right now — gated on the season FIRST (dry
 *  months are excluded outright, not just "unlikely"), then on today's
 *  district roll, then on this field's own sensor being at least moderately
 *  damp. */
function isRainingToday(season: Season, wetness: number, now: number): boolean {
  if (season.rain < 0.15) return false
  return wetness > 0.5 && seasonRainToday(season, now)
}

/** The farmer's mood: yield (Excellence/vigor) sets the baseline, but rain at
 *  the wrong moment — right at harvest-ready, or once the field is already
 *  past its crop's own wet tolerance — overrides everything into panic. Rain
 *  arriving at a good moment instead lifts the mood, capping out at happy. */
export interface FarmerMood {
  id: FarmerMoodId
  label: string
  emoji: string
  raining: boolean
  badTiming: boolean
}

function computeFarmerMood(state: SceneState, season: Season, now: number): FarmerMood {
  const { crop, growth, vigor, moisture } = state
  const wetness = wetnessOf(moisture)
  const raining = isRainingToday(season, wetness, now)
  const atHarvestReady = growth.stageIndex === growth.stages.length - 1
  const overSaturated = moisture > crop.tolerable.moisture[1]
  const badTiming = raining && (atHarvestReady || overSaturated)

  if (badTiming) return { id: 'panic', label: 'Panicking', emoji: '😱', raining, badTiming }
  if (raining) {
    return vigor < 0.4
      ? { id: 'neutral', label: 'Relieved', emoji: '🙂', raining, badTiming }
      : { id: 'happy', label: 'Happy', emoji: '😊', raining, badTiming }
  }
  if (vigor >= 0.7) return { id: 'happy', label: 'Happy', emoji: '😊', raining, badTiming }
  if (vigor >= 0.4) return { id: 'neutral', label: 'Content', emoji: '🙂', raining, badTiming }
  return { id: 'sad', label: 'Worried', emoji: '😟', raining, badTiming }
}

// ---------------------------------------------------------------------------
// Deterministic randomness — plants must keep their shape between frames.
// ---------------------------------------------------------------------------
function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rngFrom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 0-1 saturation reading off the moisture sensor — the single source both
 *  the puddles/rain and the soil tint key off, so "it looks rainy" is never
 *  disconnected from the number driving everything else in the scene. */
function wetnessOf(moisture: number): number {
  return Math.max(0, Math.min(1, (moisture - 25) / 60))
}

interface SceneState {
  field: Field
  crop: CropProfile
  growth: ReturnType<typeof computeGrowthState>
  vigor: number
  moisture: number
  produce: number
  seed: number
}

export interface PixelSceneOptions {
  static?: boolean
  width?: number
  height?: number
}

export class PixelScene {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private w: number
  private h: number
  private horizon: number
  private isStatic: boolean
  private state: SceneState | null = null
  private frame = 0
  private _raf: number | null = null
  private _lastDraw = 0
  private _dayOverride: number | null = null
  private _seasonOverride: string | null = null
  private _field: Field | null = null
  private _crop: CropProfile | null = null
  private _health: HealthAssessment | null = null
  private painter: Painter

  constructor(canvas: HTMLCanvasElement, opts: PixelSceneOptions = {}) {
    this.canvas = canvas
    canvas.width = opts.width || W
    canvas.height = opts.height || H
    this.w = canvas.width
    this.h = canvas.height
    this.horizon = Math.round(this.h * (HORIZON / H))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.ctx.imageSmoothingEnabled = false

    this.isStatic = Boolean(opts.static)

    // Painter clips writes to the canvas so sprites can't bleed outside.
    this.painter = {
      px: (x: number, y: number, color: string) => {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
        this.ctx.fillStyle = color
        this.ctx.fillRect(x, y, 1, 1)
      },
      rect: (x: number, y: number, w: number, h: number, color: string) => {
        this.ctx.fillStyle = color
        this.ctx.fillRect(x, y, w, h)
      },
    }
  }

  /** Point the scene at a field and its engine-computed health. Safe to call
   *  repeatedly. */
  setField(field: Field, crop: CropProfile, health: HealthAssessment): void {
    this._field = field
    this._crop = crop
    this._health = health
    this._rebuild()
  }

  private _rebuild(): void {
    const field = this._field
    const crop = this._crop
    const health = this._health
    if (!field || !crop) return
    const growth = computeGrowthState(field, crop, this._dayOverride)
    this.state = {
      field,
      crop,
      growth,
      vigor: Math.max(0, Math.min(1, (health?.score ?? 70) / 100)),
      moisture: health?.readings?.moisture ?? 60,
      produce: hasVisibleProduce(crop, growth.stageIndex)
        ? Math.min(1, (growth.progress - (crop.stages[(crop.productStage ?? 1) - 1]?.end ?? 0)) * 2.6)
        : 0,
      seed: hashString(field.id),
    }
    if (this.isStatic) this.draw()
  }

  /** Scrub the growth day for preview (1..crop duration), or null to go back
   *  to the field's real sown-days-ago. Doesn't touch the underlying field. */
  setDayOverride(day: number | null): void {
    this._dayOverride = day
    this._rebuild()
  }

  /** Preview a specific season id (see SEASONS), or null for the real
   *  current-calendar-month season. */
  setSeasonOverride(id: string | null): void {
    this._seasonOverride = id || null
  }

  start(): void {
    if (this.isStatic || this._raf) return
    const loop = (now: number) => {
      this._raf = requestAnimationFrame(loop)
      if (now - this._lastDraw < 1000 / FPS) return
      this._lastDraw = now
      this.frame++
      this.draw()
    }
    this._raf = requestAnimationFrame(loop)
  }

  stop(): void {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
  }

  destroy(): void {
    this.stop()
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------
  private _resolveSeason(): Season {
    return this._seasonOverride
      ? SEASONS[this._seasonOverride as keyof typeof SEASONS]
      : seasonForMonth(new Date().getMonth())
  }

  draw(): void {
    if (!this.state) return
    const s = this.state
    const now = Date.now()
    const nowDate = new Date(now)
    const hour = nowDate.getHours() + nowDate.getMinutes() / 60
    const sky = skyForHour(hour)
    const season = this._resolveSeason()
    const raining = isRainingToday(season, wetnessOf(s.moisture), now)
    const t = this.frame

    this.drawSky(sky, hour, t)
    this.drawHills(sky)
    this.drawTreeline(sky)
    this.drawGround(sky, s, raining)
    this.drawWeeds(sky, s)
    this.drawCrops(sky, s, t, season)
    this.drawFarmer(sky, s, t, season, now)
    this.drawWeather(sky, s, t, season, raining, now)
    this.drawWind(sky, s, t, season, raining)
    this.drawHaze(season)
  }

  private drawSky(sky: SkyWithPhase, hour: number, t: number): void {
    const p = this.painter
    const bands = 9
    for (let i = 0; i < bands; i++) {
      const y0 = Math.round((i / bands) * this.horizon)
      const y1 = Math.round(((i + 1) / bands) * this.horizon)
      const f = i / (bands - 1)
      const color = f < 0.5
        ? mix(sky.sky[0], sky.sky[1], f * 2)
        : mix(sky.sky[1], sky.sky[2], (f - 0.5) * 2)
      p.rect(0, y0, this.w, y1 - y0, color)
      // Ordered dithering along each seam softens the banding without gradients.
      if (i > 0) {
        const next = f < 0.5 ? mix(sky.sky[0], sky.sky[1], (f + 0.1) * 2) : sky.sky[2]
        for (let x = i % 2; x < this.w; x += 2) p.px(x, y0, next)
      }
    }

    if (sky.stars) {
      const rng = rngFrom(9182)
      for (let i = 0; i < 34; i++) {
        const sx = Math.floor(rng() * this.w)
        const sy = Math.floor(rng() * this.horizon * 0.75)
        // Slow twinkle on a subset.
        const tw = Math.sin(t * 0.12 + i) > 0.4
        p.px(sx, sy, tw ? '#ffffff' : '#b9c6e8')
      }
    }

    // Sun/moon arcs across the sky with the hour.
    const dayFrac = Math.max(0, Math.min(1, (hour - 5.5) / 14))
    const cx = Math.round(this.w * (0.1 + dayFrac * 0.8))
    const cy = Math.round(this.horizon * 0.72 - Math.sin(dayFrac * Math.PI) * this.horizon * 0.52)
    const r = 4
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r) continue
        p.px(cx + dx, cy + dy, sky.sun)
      }
    }
    if (sky.light > 0.5) {
      // Corona flicker.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + t * 0.02
        p.px(Math.round(cx + Math.cos(a) * (r + 2)), Math.round(cy + Math.sin(a) * (r + 2)), sky.sun)
      }
    }
  }

  private drawHills(sky: SkyWithPhase): void {
    const p = this.painter
    const far = mix('#2f4a55', sky.sky[2], 0.45 * sky.light)
    const near = mix('#27403c', sky.sky[2], 0.28 * sky.light)

    for (let x = 0; x < this.w; x++) {
      const h1 = 10 + Math.sin(x * 0.031) * 5 + Math.sin(x * 0.011 + 2) * 4
      const top = Math.round(this.horizon - 8 - h1)
      p.rect(x, top, 1, this.horizon - top, far)
    }
    for (let x = 0; x < this.w; x++) {
      const h2 = 5 + Math.sin(x * 0.052 + 1.4) * 3 + Math.sin(x * 0.019) * 3
      const top = Math.round(this.horizon - 3 - h2)
      p.rect(x, top, 1, this.horizon - top, near)
    }
  }

  private drawTreeline(sky: SkyWithPhase): void {
    const p = this.painter
    const rng = rngFrom(4242)
    const trunk = mix('#1d2b22', sky.sky[2], 0.12)
    const canopyColor = mix('#243a2c', sky.sky[2], 0.1)

    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rng() * this.w)
      const height = 4 + Math.floor(rng() * 5)
      const base = this.horizon - 1
      p.rect(x, base - height, 1, height, trunk)
      const r = 1 + Math.floor(rng() * 2)
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy > r * r + 1) continue
          p.px(x + dx, base - height - r + dy, canopyColor)
        }
      }
    }
  }

  private drawGround(sky: SkyWithPhase, s: SceneState, raining: boolean): void {
    const p = this.painter
    // Soil color is a direct readout of soil moisture: pale dry dust -> dark
    // saturated earth. This is the most immediately legible metric in the scene.
    const wetness = wetnessOf(s.moisture)
    const dry = '#a8895c'
    const wet = '#4a3524'
    const soil = mix(dry, wet, wetness)
    const soilLit = mix(soil, sky.sky[2], 0.12 * sky.light)

    p.rect(0, this.horizon, this.w, this.h - this.horizon, soilLit)

    // Perspective furrow lines, denser toward the horizon.
    for (let y = this.horizon; y < this.h; y++) {
      const t = (y - this.horizon) / (this.h - this.horizon)
      const step = Math.max(2, Math.round(3 + t * 9))
      if ((y - this.horizon) % step === 0) {
        for (let x = 0; x < this.w; x += 2) {
          p.px(x + (y % 2), y, shade(soilLit, 0.9))
        }
      }
    }

    // Planting ridges: a brighter soil band directly under each crop row, at
    // the exact same depth math drawCrops uses for baseY — so the ground
    // reads as deliberately ridge-sown in straight lines, not just a texture
    // the plants happen to float over. Flooded paddy has no ridges, so it's
    // skipped.
    if (!s.crop.flooded) {
      const rows = s.crop.art.rows
      const fieldTop = this.horizon + 3
      const fieldDepth = this.h - fieldTop
      const ridge = shade(soilLit, 1.14)
      for (let row = 0; row < rows; row++) {
        const depth = row / Math.max(1, rows - 1)
        const y = Math.round(fieldTop + depth * (fieldDepth - 3)) + 1
        for (let x = 0; x < this.w; x += 3) p.px(x, y, ridge)
      }
    }

    // Standing water for flooded crops (paddy).
    if (s.crop.flooded && s.moisture > 55) {
      const waterTop = this.horizon + 2
      const water = mix('#3a6b7d', sky.sky[1], 0.35)
      for (let y = waterTop; y < this.h; y++) {
        const rowT = (y - waterTop) / (this.h - waterTop)
        for (let x = 0; x < this.w; x++) {
          // Sparse dithered coverage so soil shows through, like a wet field.
          if ((x + y * 2) % 3 === 0) p.px(x, y, water)
        }
        // Animated shimmer streaks.
        if (Math.round(Math.sin(this.frame * 0.09 + rowT * 6) * 3) % 3 === 0) {
          for (let x = (this.frame * 2) % 7; x < this.w; x += 7) {
            p.px(x, y, mix(water, '#cfe9f2', 0.5))
          }
        }
      }
    }

    // Stagnant water: a non-paddy field waterlogs in its low spots on an
    // actual rain day (same `raining` flag drawWeather's streaks use) — not
    // just whenever the moisture sensor happens to spike from irrigation.
    if (!s.crop.flooded && raining) {
      const water = mix('#3a6b7d', sky.sky[1], 0.4)
      const rng = rngFrom(hashString(s.field.id + 'puddle'))
      const puddleCount = 3 + Math.round(Math.max(0, wetness - 0.5) * 24)
      for (let i = 0; i < puddleCount; i++) {
        const t = rng()
        const py = Math.round(this.horizon + 4 + t * (this.h - this.horizon - 8))
        const px0 = Math.floor(rng() * this.w)
        const rx = 3 + Math.round(rng() * 4 * (0.4 + t))
        const ry = Math.max(1, Math.round(rx * 0.32))
        for (let dx = -rx; dx <= rx; dx++) {
          for (let dy = -ry; dy <= ry; dy++) {
            if ((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) > 1) continue
            const shimmer = (dx + dy + this.frame) % 5 === 0
            p.px(px0 + dx, py + dy, shimmer ? mix(water, '#cfe9f2', 0.45) : water)
          }
        }
      }
    }
  }

  /** Weed tufts filling the gaps a neglected (low-score) field leaves bare —
   *  a stand with more failed slots reads as more weed-choked, not just
   *  empty. */
  private drawWeeds(sky: SkyWithPhase, s: SceneState): void {
    if (s.crop.flooded) return
    const p = this.painter
    const fieldTop = this.horizon + 2
    const weedLeaf = mix('#a3b155', sky.sky[1], (1 - sky.light) * 0.55)
    const weedDark = shade(weedLeaf, 0.68)
    // Every real field carries some weed pressure along bunds and gaps, not
    // just neglected ones — a well-kept field is weeded down, not weed-free.
    const density = Math.round(18 + (1 - s.vigor) * 46)
    const rng = rngFrom(hashString(s.field.id + 'weeds'))

    for (let i = 0; i < density; i++) {
      const t = rng()
      const y = Math.round(fieldTop + t * (this.h - fieldTop - 2))
      const x = Math.floor(rng() * this.w)
      const scale = 0.5 + t * 0.8
      const h = Math.max(1, Math.round((2 + rng() * 2.4) * scale))
      for (let b = -1; b <= 1; b++) {
        const bh = b === 0 ? h : Math.round(h * 0.72)
        for (let dy = 0; dy < bh; dy++) {
          p.px(x + b, y - dy, dy === bh - 1 ? weedDark : weedLeaf)
        }
      }
    }

    // A denser weedy fringe along the near bund (bottom edge, closest to
    // camera) — the strip growers usually don't bother weeding right at the
    // field margin.
    const fringe = 10
    for (let i = 0; i < fringe; i++) {
      const x = Math.floor(rng() * this.w)
      const y = this.h - 2 - Math.floor(rng() * 3)
      const h = 3 + Math.floor(rng() * 3)
      for (let dy = 0; dy < h; dy++) p.px(x, y - dy, dy === h - 1 ? weedDark : weedLeaf)
    }
  }

  private drawCrops(sky: SkyWithPhase, s: SceneState, t: number, season: Season): void {
    const { crop, growth, vigor, produce } = s
    const art = crop.art
    const colors = foliageColors(art.palette, vigor)
    // Dim foliage toward the sky's ambient light so night reads as night.
    const c = {
      leaf: mix(colors.leaf, sky.sky[1], (1 - sky.light) * 0.55),
      leafDark: mix(colors.leafDark, sky.sky[0], (1 - sky.light) * 0.55),
      stem: mix(colors.stem, sky.sky[1], (1 - sky.light) * 0.5),
      product: mix(colors.product, sky.sky[1], (1 - sky.light) * 0.4),
    }

    const rows = art.rows
    const perRow = art.perRow
    const fieldTop = this.horizon + 3
    const fieldDepth = this.h - fieldTop

    // Back-to-front so nearer rows overlap farther ones.
    for (let row = 0; row < rows; row++) {
      const depth = row / Math.max(1, rows - 1)
      const baseY = Math.round(fieldTop + depth * (fieldDepth - 3))
      // Perspective scale: distant rows smaller, front row full size.
      const scale = 0.42 + depth * 0.58
      const plantH = Math.max(2, art.matureH * scale * growth.maturity)

      // Every row keeps the SAME planting-slot count, so columns of plants
      // stay aligned front-to-back like real drilled/transplanted rows. The
      // row's width converges with `scale` for a true receding-into-the-
      // distance perspective, narrower and centred for farther rows.
      const rowWidth = this.w * (0.5 + scale * 0.5)
      const rowLeft = (this.w - rowWidth) / 2
      const spacing = rowWidth / perRow

      for (let i = 0; i < perRow; i++) {
        const seed = s.seed + row * 7919 + i * 104729
        const rng = rngFrom(seed)
        // Bare gaps where the stand has failed — the clearest read on a poor field.
        if (rng() > 0.34 + vigor * 0.66) continue

        // Only a sliver of in-slot jitter — enough to avoid a laser-cut look,
        // not enough to break the straight, ridge-sown rows a real field has.
        const x = Math.round(rowLeft + (i + 0.5) * spacing + (rng() - 0.5) * spacing * 0.1)
        const phase = rng() * Math.PI * 2
        // Wind: nearer rows sway more, and a stressed crop is stiffer/limper.
        // The season scales both the flutter amplitude and a steady lean, so
        // a high-wind month (SW monsoon) reads as the whole field visibly
        // leaning one way with fast flutter on top, not just gently rocking.
        const gust = 0.55 + season.wind * 1.3
        const lean = (season.wind - 0.3) * 1.1 * (0.5 + depth * 0.7)
        const sway = Math.sin(t * (0.09 + season.wind * 0.05) + phase + depth * 1.5)
          * (0.6 + depth * 1.5) * gust + lean

        drawPlant(art.sprite, this.painter, {
          x,
          baseY,
          h: plantH * (0.85 + rng() * 0.3),
          c,
          vigor,
          maturity: growth.maturity,
          sway,
          rng,
          produce,
        })
      }
    }
  }

  private drawWeather(
    sky: SkyWithPhase,
    s: SceneState,
    t: number,
    season: Season,
    raining: boolean,
    now: number
  ): void {
    const p = this.painter

    // Drifting clouds — faster and more of them once the SW monsoon wind
    // picks up.
    const rng = rngFrom(31337)
    const cloudCount = season.wind > 0.7 ? 5 : 3
    for (let i = 0; i < cloudCount; i++) {
      const speed = (0.06 + i * 0.04) * (0.6 + season.wind * 1.1)
      const baseX = ((rng() * this.w + t * speed) % (this.w + 40)) - 20
      const y = 8 + Math.floor(rng() * 22)
      const len = 10 + Math.floor(rng() * 14)
      const cloud = mix('#ffffff', sky.sky[1], 0.35 + (1 - sky.light) * 0.4)
      for (let x = 0; x < len; x++) {
        const bulge = Math.round(Math.sin((x / len) * Math.PI) * 2.2)
        for (let dy = 0; dy <= bulge; dy++) {
          p.px(Math.round(baseX + x), y - dy, dy === bulge ? mix(cloud, '#ffffff', 0.5) : cloud)
        }
      }
    }

    // Irrigation sparkle on the day water is applied — ties the scene to the
    // moisture sawtooth in engine/digitalTwin/simulateField.ts.
    const cycle = Math.max(1, s.field.irrigationCycleDays || 6)
    const dayPhase = Math.floor(now / 86_400_000) % cycle
    if (dayPhase === 0 && sky.light > 0.5) {
      for (let i = 0; i < 14; i++) {
        const dropRng = rngFrom(i * 977 + Math.floor(t / 6))
        const x = Math.floor(dropRng() * this.w)
        const y = this.horizon + Math.floor(dropRng() * (this.h - this.horizon))
        p.px(x, y, '#bfe6f5')
      }
    }

    // Rain — only on an actual rain day (season-gated, see isRainingToday),
    // never "always"; intensity still tracks how damp this field's own
    // sensor is, so a heavier downpour looks heavier.
    if (raining) {
      const wetness = wetnessOf(s.moisture)
      const intensity = 12 + Math.round(wetness * 22)
      const windDrift = (season.wind - 0.3) * 0.5
      const dropRng = rngFrom(51117)
      for (let i = 0; i < intensity; i++) {
        const bx = Math.floor(dropRng() * (this.w + 20)) - 10
        const phase = dropRng()
        const by = ((phase + t * 0.05) % 1) * (this.h + 14) - 10
        for (let d = 0; d < 4; d++) {
          p.px(Math.round(bx + d * (0.35 + windDrift)), Math.round(by + d), 'rgba(191,230,245,0.55)')
        }
      }
    }

    // A bird or two on nice days, for life.
    if (sky.light > 0.55) {
      for (let b = 0; b < 2; b++) {
        const bx = ((t * (0.35 + b * 0.2) + b * 90) % (this.w + 30)) - 15
        const by = 16 + b * 9 + Math.round(Math.sin(t * 0.06 + b) * 2)
        const flap = Math.sin(t * 0.4 + b * 2) > 0 ? 1 : -1
        const ink = mix('#1b2430', sky.sky[2], 0.15)
        p.px(Math.round(bx), by, ink)
        p.px(Math.round(bx) - 1, by - flap, ink)
        p.px(Math.round(bx) + 1, by - flap, ink)
      }
    }
  }

  /** Dry topsoil kicked up by a strong wind — dust in the dry/windy months,
   *  nothing once the ground's actually wet (blowing dust needs dry dirt). */
  private drawWind(sky: SkyWithPhase, s: SceneState, t: number, season: Season, raining: boolean): void {
    if (season.wind < 0.7 || raining) return
    const wetness = wetnessOf(s.moisture)
    if (wetness > 0.55) return
    const p = this.painter
    const dust = mix('#c9b183', sky.sky[2], 0.2)
    const rng = rngFrom(hashString(s.field.id + 'dust'))
    const streaks = Math.round((season.wind - 0.6) * 40)
    for (let i = 0; i < streaks; i++) {
      const laneY = this.horizon - 6 + Math.floor(rng() * (this.h - this.horizon + 6))
      const speed = 1.6 + rng() * 1.4
      const bx = ((rng() * this.w + t * speed) % (this.w + 24)) - 12
      const len = 3 + Math.floor(rng() * 3)
      for (let d = 0; d < len; d++) {
        p.px(Math.round(bx - d), laneY, d === 0 ? dust : shade(dust, 0.85))
      }
    }
  }

  /** The farmer standing at the near edge of his own field — Excellence sets
   *  his baseline mood, rain at the wrong moment (harvest-ready, or past his
   *  crop's own wet tolerance) overrides it into panic. He holds a sample of
   *  the actual crop, colored the same as the field, so a struggling stand
   *  in the field is a wilted handful in his hand too. */
  private drawFarmer(sky: SkyWithPhase, s: SceneState, t: number, season: Season, now: number): void {
    const mood = computeFarmerMood(s, season, now)
    const h = Math.round(this.h * 0.36)
    const x = Math.round(this.w * 0.63)
    const baseY = this.h - 2
    const idle = Math.sin(t * 0.05) * 0.5
    const windLean = (season.wind - 0.3) * 0.7
    const sway = idle + windLean

    // Same night-dimming every other layer in the scene gets, so the farmer
    // doesn't look pasted on at a different exposure than the field he's in.
    const dim = (hex: string) => mix(hex, sky.sky[1], (1 - sky.light) * 0.5)
    const cropColors = foliageColors(s.crop.art.palette, s.vigor)
    const c = {
      skin: dim('#b9744a'),
      kurta: dim('#f2e2b0'),
      pants: dim('#e9ddbe'),
      turbanRed: dim('#c0392b'),
      turbanWhite: dim('#f4ede0'),
      phoneScreen: dim('#5fd0e8'),
      crop: dim(cropColors.leaf),
    }

    paintFarmer(this.painter, { x, baseY, h, mood: mood.id, sway, c })
  }

  /** Hot-season haze — a thin warm veil over the whole scene, the one effect
   *  that isn't just per-pixel color math since it has to sit over
   *  everything drawn so far including the crops. */
  private drawHaze(season: Season): void {
    if (season.haze <= 0) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = season.haze * 0.14
    ctx.fillStyle = '#e8c98a'
    ctx.fillRect(0, 0, this.w, this.h)
    ctx.restore()
  }

  /** Current sky phase label, for the dashboard HUD. */
  get phase(): string {
    const hour = new Date().getHours() + new Date().getMinutes() / 60
    return skyForHour(hour).phase
  }

  /** Current season label, for the dashboard HUD. */
  get season(): string {
    return this._resolveSeason().name
  }

  /** The farmer's current mood, for the dashboard caption — kept in sync
   *  with whatever drawFarmer is actually rendering. */
  get farmerMood(): FarmerMood {
    if (!this.state) return { id: 'neutral', label: 'Content', emoji: '🙂', raining: false, badTiming: false }
    return computeFarmerMood(this.state, this._resolveSeason(), Date.now())
  }
}

/** One-shot small scene for the area cards on the selection screen. */
export function renderThumbnail(
  canvas: HTMLCanvasElement,
  field: Field,
  crop: CropProfile,
  health: HealthAssessment
): PixelScene {
  const scene = new PixelScene(canvas, { static: true, width: 96, height: 54 })
  scene.setField(field, crop, health)
  return scene
}
