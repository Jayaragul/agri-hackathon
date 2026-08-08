// Procedural pixel-art plant sprites.
//
// Every crop has a draw function that plots individual pixels. Nothing is a
// loaded image asset — sprites are generated from the crop's palette and
// reshaped by two live inputs from the deterministic engine, which is the
// whole point:
//
//    maturity (0-1)  from engine/digitalTwin/growthModel -> height, structure,
//                    whether the plant is a two-leaf sprout or a full canopy
//    vigor (0-1)     from engine/digitalTwin/healthModel's Excellence score ->
//                    leaf color (green <-> yellow <-> brown), how far leaves
//                    droop, and how much produce shows
//
// This module is pure presentation: it only draws what the engine decided.
// It never computes a score or a growth day itself.
//
// Conventions for every draw function:
//   * (x, baseY) is the pixel the plant stands ON; it grows upward (-Y).
//   * `h` is already scaled by maturity, so builders just use it.
//   * `sway` is a signed horizontal offset applied more strongly higher up
//     the plant, which is what makes a field look wind-blown rather than
//     frozen.
//   * `rng()` is seeded per plant, so a given plant never changes shape
//     between frames — only its sway does.
//
// Ported from FieldWatch's `pixel/sprites.js`.

export interface Painter {
  px(x: number, y: number, color: string): void
  rect(x: number, y: number, w: number, h: number, color: string): void
}

export interface PlantColors {
  leaf: string
  leafDark: string
  stem: string
  product: string
}

/** The full set of inputs a crop sprite builder may draw from. Individual
 *  builders destructure only the subset they need. */
export interface PlantDrawContext {
  x: number
  baseY: number
  h: number
  c: PlantColors
  vigor: number
  maturity: number
  sway: number
  rng: () => number
  produce: number
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(rgb[0])}${c(rgb[1])}${c(rgb[2])}`
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  return rgbToHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as [number, number, number])
}

export function shade(hex: string, factor: number): string {
  return rgbToHex(hexToRgb(hex).map((v) => v * factor) as [number, number, number])
}

/**
 * Resolves a crop palette into the actual colors to draw with at this vigor.
 * Below ~0.5 vigor leaves move through stressed yellow toward dry brown,
 * which is how a struggling crop genuinely reads from a distance.
 */
export function foliageColors(
  palette: { stem: string; leaf: string; leafDark: string; stress: string; dry: string; product: string },
  vigor: number
): PlantColors {
  const v = Math.max(0, Math.min(1, vigor))
  const leaf = v >= 0.5
    ? mix(palette.stress, palette.leaf, (v - 0.5) / 0.5)
    : mix(palette.dry, palette.stress, v / 0.5)
  const leafDark = v >= 0.5
    ? mix(shade(palette.stress, 0.8), palette.leafDark, (v - 0.5) / 0.5)
    : mix(shade(palette.dry, 0.8), shade(palette.stress, 0.85), v / 0.5)
  return { leaf, leafDark, stem: mix(palette.dry, palette.stem, v), product: palette.product }
}

// ---------------------------------------------------------------------------
// Sprite builders. Each: (p, ctx) where p is the painter and ctx bundles inputs.
// ---------------------------------------------------------------------------

function sugarcane(p: Painter, { x, baseY, h, c, vigor, maturity, sway, rng, produce }: PlantDrawContext) {
  const canes = h < 10 ? 2 : 3
  for (let i = 0; i < canes; i++) {
    const off = (i - (canes - 1) / 2) * 2
    const ch = h * (0.82 + rng() * 0.3)
    const tipSway = sway * 1.2

    // Cane with visible internode banding.
    for (let y = 0; y < ch; y++) {
      const t = y / Math.max(1, ch)
      const sx = Math.round(x + off + tipSway * t)
      const banded = maturity > 0.35 && y % 5 === 0
      p.px(sx, baseY - y, banded ? shade(c.stem, 0.78) : c.stem)
    }

    // Blades fan out from the upper third, drooping harder when vigor is low.
    const blades = h < 10 ? 2 : 4
    for (let b = 0; b < blades; b++) {
      const attach = ch * (0.45 + (b / blades) * 0.5)
      const dir = b % 2 === 0 ? 1 : -1
      const len = Math.max(2, h * 0.36 * (0.7 + rng() * 0.5))
      const droop = 0.35 + (1 - vigor) * 0.9
      let bx = x + off + tipSway * (attach / Math.max(1, ch))
      let by = baseY - attach
      for (let s = 0; s < len; s++) {
        bx += dir * 0.85
        by += s * droop * 0.16 - 0.4 // rises then arcs over
        p.px(Math.round(bx), Math.round(by), b % 2 === 0 ? c.leaf : c.leafDark)
      }
    }
  }
  if (produce > 0.3 && h > 14) {
    p.px(Math.round(x + sway * 1.2), baseY - h - 1, c.product)
  }
}

function rice(p: Painter, { x, baseY, h, c, sway, rng, produce }: PlantDrawContext) {
  const blades = h < 6 ? 3 : 6
  for (let i = 0; i < blades; i++) {
    const dir = i % 2 === 0 ? 1 : -1
    const spread = (i / blades) * 1.6 * dir
    const bh = h * (0.7 + rng() * 0.45)
    let bx = x
    for (let y = 0; y < bh; y++) {
      const t = y / Math.max(1, bh)
      bx = x + spread * t + sway * t * 1.3
      p.px(Math.round(bx), baseY - y, t > 0.6 ? c.leafDark : c.leaf)
    }
    // Drooping grain panicle — the signature look of a filling paddy.
    if (produce > 0.25 && i % 2 === 0) {
      const px0 = Math.round(bx)
      const py0 = baseY - bh
      for (let g = 0; g < 3; g++) {
        p.px(px0 + dir * g, py0 + Math.round(g * 0.9), c.product)
      }
    }
  }
}

function coconut(p: Painter, { x, baseY, h, c, vigor, maturity, sway, rng, produce }: PlantDrawContext) {
  const trunkH = h * 0.72
  // Trunk: two pixels wide with a lighter left edge, leaning with the wind.
  for (let y = 0; y < trunkH; y++) {
    const t = y / Math.max(1, trunkH)
    const sx = Math.round(x + sway * t * 0.8)
    p.px(sx, baseY - y, c.stem)
    p.px(sx + 1, baseY - y, shade(c.stem, 0.74))
    if (y % 4 === 0) p.px(sx, baseY - y, shade(c.stem, 1.16))
  }

  const topX = x + sway * 0.8
  const topY = baseY - trunkH
  const fronds = maturity < 0.3 ? 4 : 7
  const frondLen = Math.max(3, h * 0.34)

  for (let f = 0; f < fronds; f++) {
    const a = (f / (fronds - 1)) * Math.PI // 0..PI, a fan over the crown
    const dir = Math.cos(a)
    const lift = Math.sin(a)
    const droop = 0.55 + (1 - vigor) * 0.85
    for (let s = 0; s < frondLen; s++) {
      const t = s / frondLen
      const fx = topX + dir * s * 1.05
      const fy = topY - lift * s * 0.55 + Math.pow(t, 2) * frondLen * droop * 0.42
      p.px(Math.round(fx), Math.round(fy), f % 2 === 0 ? c.leaf : c.leafDark)
      // Leaflet fringe gives the frond visual weight.
      if (s > 1 && s % 2 === 0) p.px(Math.round(fx), Math.round(fy) - 1, c.leafDark)
    }
  }

  if (produce > 0.2) {
    const nuts = produce > 0.6 ? 3 : 2
    for (let n = 0; n < nuts; n++) {
      p.px(Math.round(topX - 1 + n), Math.round(topY + 2), c.product)
      p.px(Math.round(topX - 1 + n), Math.round(topY + 3), shade(c.product, 0.8))
    }
  }
}

function banana(p: Painter, { x, baseY, h, c, vigor, maturity, sway, rng, produce }: PlantDrawContext) {
  const stemH = h * 0.52
  for (let y = 0; y < stemH; y++) {
    const t = y / Math.max(1, stemH)
    const sx = Math.round(x + sway * t * 0.7)
    p.px(sx, baseY - y, c.stem)
    p.px(sx + 1, baseY - y, shade(c.stem, 0.78))
  }

  const topX = x + sway * 0.7
  const topY = baseY - stemH
  const leaves = maturity < 0.3 ? 3 : 5
  const leafLen = Math.max(4, h * 0.42)

  for (let l = 0; l < leaves; l++) {
    const dir = l % 2 === 0 ? 1 : -1
    const rise = 0.6 - (l / leaves) * 0.5
    const droop = 0.5 + (1 - vigor) * 0.9
    for (let s = 0; s < leafLen; s++) {
      const t = s / leafLen
      const lx = topX + dir * s * 1.0
      const ly = topY - rise * s * 0.8 + Math.pow(t, 2) * leafLen * droop * 0.5
      // Broad blade: paint a short vertical run so the leaf has real width.
      const width = Math.max(1, Math.round((1 - t) * 3))
      for (let w = 0; w < width; w++) {
        p.px(Math.round(lx), Math.round(ly) + w, w === 0 ? c.leaf : c.leafDark)
      }
    }
  }

  if (produce > 0.25) {
    const bx = Math.round(topX + 1)
    const by = Math.round(topY + 3)
    for (let r = 0; r < 3; r++) {
      p.px(bx, by + r, c.product)
      p.px(bx + 1, by + r, shade(c.product, 0.82))
    }
  }
}

function maize(p: Painter, { x, baseY, h, c, vigor, maturity, sway, rng, produce }: PlantDrawContext) {
  for (let y = 0; y < h; y++) {
    const t = y / Math.max(1, h)
    p.px(Math.round(x + sway * t * 1.1), baseY - y, c.stem)
  }
  const leaves = h < 8 ? 2 : 5
  for (let l = 0; l < leaves; l++) {
    const attach = h * (0.2 + (l / leaves) * 0.68)
    const dir = l % 2 === 0 ? 1 : -1
    const len = Math.max(2, h * 0.32 * (0.8 + rng() * 0.4))
    const droop = 0.4 + (1 - vigor) * 1.0
    let lx = x + sway * (attach / Math.max(1, h)) * 1.1
    let ly = baseY - attach
    for (let s = 0; s < len; s++) {
      const t = s / len
      lx += dir * 0.95
      ly += t * droop * 0.75 - 0.28
      p.px(Math.round(lx), Math.round(ly), l % 2 === 0 ? c.leaf : c.leafDark)
    }
  }
  // Tassel at the top once it has shot.
  if (maturity > 0.5) {
    const tx = Math.round(x + sway * 1.1)
    p.px(tx, baseY - h - 1, shade(c.product, 0.85))
    p.px(tx - 1, baseY - h, shade(c.product, 0.7))
  }
  if (produce > 0.2) {
    const cy = baseY - h * 0.52
    const cx = Math.round(x + sway * 0.6) + 1
    for (let s = 0; s < Math.max(2, Math.round(h * 0.16)); s++) {
      p.px(cx, Math.round(cy) + s, c.product)
    }
  }
}

function cotton(p: Painter, { x, baseY, h, c, sway, rng, produce }: PlantDrawContext) {
  for (let y = 0; y < h; y++) {
    p.px(Math.round(x + sway * (y / Math.max(1, h)) * 0.8), baseY - y, c.stem)
  }
  // Bushy canopy as clustered pixel blobs.
  const clusters = h < 8 ? 3 : 6
  for (let i = 0; i < clusters; i++) {
    const cy = baseY - h * (0.32 + (i / clusters) * 0.66)
    const spreadX = (rng() - 0.5) * Math.max(2, h * 0.5)
    const cx = x + spreadX + sway * 0.7
    const r = Math.max(1, Math.round(h * 0.14))
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        p.px(Math.round(cx + dx), Math.round(cy + dy), dy < 0 ? c.leaf : c.leafDark)
      }
    }
  }
  if (produce > 0.15) {
    const bolls = produce > 0.6 ? 3 : 2
    for (let b = 0; b < bolls; b++) {
      const bx = Math.round(x + (rng() - 0.5) * h * 0.7 + sway * 0.7)
      const by = Math.round(baseY - h * (0.4 + rng() * 0.5))
      p.px(bx, by, c.product)
      p.px(bx + 1, by, c.product)
      p.px(bx, by + 1, shade(c.product, 0.86))
    }
  }
}

interface LowBushOptions {
  lobes: number
  spread: number
  radius: number
}

function lowBush(p: Painter, ctx: PlantDrawContext, opts: LowBushOptions) {
  const { x, baseY, h, c, sway, rng } = ctx
  const { lobes } = opts
  for (let i = 0; i < lobes; i++) {
    const dir = (i / (lobes - 1 || 1)) * 2 - 1
    const cx = x + dir * Math.max(1, h * opts.spread) + sway * 0.5
    const lobeH = h * (0.7 + rng() * 0.45)
    const r = Math.max(1, Math.round(lobeH * opts.radius))
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = 0; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        const top = dy >= r - 1
        p.px(Math.round(cx + dx), baseY - dy, top ? c.leaf : c.leafDark)
      }
    }
    // A couple of upright leaflets break the silhouette so it isn't just domes.
    if (h > 5) {
      const lx = Math.round(cx)
      for (let s = 0; s < Math.round(h * 0.4); s++) {
        p.px(lx + Math.round(sway * 0.6), baseY - r - s, c.leaf)
      }
    }
  }
}

function groundnut(p: Painter, ctx: PlantDrawContext) {
  // Pods are underground, so there is deliberately no produce drawn — vigor
  // and canopy spread are the only signals this crop gives from above.
  lowBush(p, ctx, { lobes: 3, spread: 0.55, radius: 0.85 })
}

function turmeric(p: Painter, { x, baseY, h, c, vigor, sway, rng }: PlantDrawContext) {
  const leaves = h < 8 ? 3 : 6
  for (let i = 0; i < leaves; i++) {
    const dir = i % 2 === 0 ? 1 : -1
    const lean = (i / leaves - 0.5) * 2
    const lh = h * (0.72 + rng() * 0.4)
    const droop = (1 - vigor) * 0.6
    for (let y = 0; y < lh; y++) {
      const t = y / Math.max(1, lh)
      const lx = x + lean * t * 2.2 + sway * t * 1.1 + dir * droop * t * 1.5
      // Broad paddle blade: 2px wide over the upper half.
      p.px(Math.round(lx), baseY - y, t > 0.55 ? c.leafDark : c.leaf)
      if (t > 0.3) p.px(Math.round(lx) + dir, baseY - y, c.leafDark)
    }
  }
}

function onion(p: Painter, { x, baseY, h, c, vigor, sway, rng, produce }: PlantDrawContext) {
  // Bulb sitting at the soil line, swelling with the crop stage.
  if (produce > 0.1) {
    const r = Math.max(1, Math.round(1 + produce * 1.6))
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = 0; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        p.px(x + dx, baseY - dy, dy === r ? shade(c.product, 1.15) : c.product)
      }
    }
  }
  // Tubular leaves fanning up.
  const leaves = h < 5 ? 2 : 4
  for (let i = 0; i < leaves; i++) {
    const dir = i % 2 === 0 ? 1 : -1
    const lean = (i / leaves - 0.5) * 1.8
    const lh = h * (0.75 + rng() * 0.4)
    const flop = (1 - vigor) * 1.2
    for (let y = 0; y < lh; y++) {
      const t = y / Math.max(1, lh)
      const lx = x + lean * t * 1.4 + sway * t * 1.2 + dir * flop * t * t * 2
      p.px(Math.round(lx), baseY - y - 1, t > 0.7 ? c.leafDark : c.leaf)
    }
  }
}

function tomato(p: Painter, ctx: PlantDrawContext) {
  const { x, baseY, h, c, sway, rng, produce } = ctx
  for (let y = 0; y < h; y++) {
    p.px(Math.round(x + sway * (y / Math.max(1, h)) * 0.7), baseY - y, c.stem)
  }
  const clusters = h < 8 ? 3 : 5
  for (let i = 0; i < clusters; i++) {
    const cy = baseY - h * (0.3 + (i / clusters) * 0.68)
    const cx = x + (rng() - 0.5) * Math.max(2, h * 0.55) + sway * 0.6
    const r = Math.max(1, Math.round(h * 0.16))
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        p.px(Math.round(cx + dx), Math.round(cy + dy), dy < 0 ? c.leaf : c.leafDark)
      }
    }
  }
  if (produce > 0.15) {
    const fruits = produce > 0.6 ? 3 : 2
    for (let f = 0; f < fruits; f++) {
      const fx = Math.round(x + (rng() - 0.5) * h * 0.6 + sway * 0.6)
      const fy = Math.round(baseY - h * (0.3 + rng() * 0.5))
      p.px(fx, fy, c.product)
      p.px(fx + 1, fy, shade(c.product, 0.85))
      p.px(fx, fy + 1, shade(c.product, 0.7))
    }
  }
}

function redgram(p: Painter, { x, baseY, h, c, sway, rng, produce }: PlantDrawContext) {
  for (let y = 0; y < h; y++) {
    p.px(Math.round(x + sway * (y / Math.max(1, h)) * 0.9), baseY - y, c.stem)
  }
  // Branching shrub: side branches with foliage blobs.
  const branches = h < 8 ? 2 : 4
  for (let b = 0; b < branches; b++) {
    const attach = h * (0.35 + (b / branches) * 0.6)
    const dir = b % 2 === 0 ? 1 : -1
    const len = Math.max(2, h * 0.26)
    let bx = x + sway * (attach / Math.max(1, h)) * 0.9
    let by = baseY - attach
    for (let s = 0; s < len; s++) {
      bx += dir * 0.9
      by -= 0.45
      p.px(Math.round(bx), Math.round(by), c.leafDark)
    }
    const r = Math.max(1, Math.round(h * 0.13))
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (dx * dx + dy * dy > r * r + 1) continue
        p.px(Math.round(bx + dx), Math.round(by + dy), dy < 0 ? c.leaf : c.leafDark)
      }
    }
    if (produce > 0.2 && b % 2 === 0) {
      p.px(Math.round(bx), Math.round(by) + r, c.product)
    }
  }
}

const SPRITES: Record<string, (p: Painter, ctx: PlantDrawContext) => void> = {
  sugarcane,
  rice,
  coconut,
  banana,
  maize,
  cotton,
  groundnut,
  turmeric,
  onion,
  tomato,
  redgram,
}

/** Fallback so an unknown crop renders as a plain tuft instead of throwing. */
function genericPlant(p: Painter, { x, baseY, h, c, sway }: PlantDrawContext) {
  for (let i = -1; i <= 1; i++) {
    for (let y = 0; y < h; y++) {
      const t = y / Math.max(1, h)
      p.px(Math.round(x + i * t * 1.5 + sway * t), baseY - y, i === 0 ? c.leaf : c.leafDark)
    }
  }
}

export function drawPlant(spriteId: string, painter: Painter, ctx: PlantDrawContext): void {
  ;(SPRITES[spriteId] || genericPlant)(painter, ctx)
}

export function hasSprite(spriteId: string): boolean {
  return Boolean(SPRITES[spriteId])
}

// ---------------------------------------------------------------------------
// The farmer. Not a crop — a small pixel-art figure standing at the near edge
// of his own field: cream kurta, a checkered red-white gamcha at the neck and
// wound as a turban, phone in one hand, a sample of the field's own crop in
// the other. `mood` reshapes his posture and face; `c.crop` is the same
// vigor-tinted color the field's plants use, so a wilted stand is a wilted
// handful in his hand too.
// ---------------------------------------------------------------------------
export type FarmerMoodId = 'happy' | 'neutral' | 'sad' | 'panic'

export interface FarmerColors {
  skin: string
  kurta: string
  pants: string
  turbanRed: string
  turbanWhite: string
  phoneScreen: string
  crop: string
}

export interface FarmerDrawContext {
  x: number
  baseY: number
  h: number
  mood: FarmerMoodId
  sway: number
  c: FarmerColors
}

export function paintFarmer(p: Painter, { x, baseY, h, mood, sway, c }: FarmerDrawContext): void {
  const ink = '#171213'
  const phoneBody = '#14151b'
  const kurtaShade = shade(c.kurta, 0.85)
  const pantsShade = shade(c.pants, 0.85)
  const skinShade = shade(c.skin, 0.82)
  const turbanRedDark = shade(c.turbanRed, 0.8)

  const legH = h * 0.33
  const torsoH = h * 0.31
  const headR = Math.max(2, Math.round(h * 0.13))
  const neckY = baseY - legH - torsoH

  // A sad farmer hunches a touch; a happy one stands a touch taller.
  const slump = mood === 'sad' ? h * 0.05 : 0
  const lift = mood === 'happy' ? h * 0.02 : 0
  // Lean grows from feet (0) to head (1) — same idea as the crop sway, so
  // wind reads consistently across the whole scene.
  const lean = (fracUp: number) => sway * fracUp

  // --- Legs ---
  for (let side = -1; side <= 1; side += 2) {
    const lx = Math.round(x + side * 1.6 + lean(0.15))
    for (let y = 0; y < legH; y++) {
      p.px(lx, Math.round(baseY - y), y > legH * 0.65 ? pantsShade : c.pants)
    }
  }

  // --- Torso (kurta), tapered, shortened by the sad-mood hunch ---
  const torsoTop = neckY + slump
  const torsoBottom = baseY - legH
  const torsoSpan = Math.max(1, torsoBottom - torsoTop)
  for (let y = 0; y <= torsoSpan; y++) {
    const cy = torsoBottom - y
    const t2 = y / torsoSpan
    const halfW = Math.max(1, Math.round(2.6 - t2 * 0.6))
    const dx0 = lean(0.4 + t2 * 0.3)
    for (let dx = -halfW; dx <= halfW; dx++) {
      p.px(Math.round(x + dx + dx0), cy, dx >= halfW ? kurtaShade : c.kurta)
    }
  }

  // --- Gamcha: checkered cloth hanging from the neck over the chest ---
  for (let side = -1; side <= 1; side += 2) {
    const gx = Math.round(x + side * 2 + lean(0.65))
    const gLen = torsoSpan * 0.55
    for (let y = 0; y < gLen; y++) {
      const checker = Math.floor(y / 2) % 2 === 0
      p.px(gx, Math.round(torsoTop + torsoSpan * 0.1 + y), checker ? c.turbanRed : c.turbanWhite)
    }
  }

  // --- Head + wound turban ---
  const headX = Math.round(x + lean(0.92))
  const headY = Math.round(neckY - headR - slump + lift)
  for (let dx = -headR; dx <= headR; dx++) {
    for (let dy = -headR; dy <= headR; dy++) {
      if (dx * dx + dy * dy > headR * headR) continue
      if (dy < -headR * 0.1) {
        const checker = (dx + dy * 2) % 3 === 0
        p.px(headX + dx, headY + dy, checker ? c.turbanWhite : c.turbanRed)
      } else {
        p.px(headX + dx, headY + dy, dy > headR * 0.35 ? skinShade : c.skin)
      }
    }
  }
  // Turban tail draping down the back.
  for (let s = 0; s < headR * 1.4; s++) {
    const checker = Math.floor(s / 2) % 2 === 0
    p.px(headX + headR - 1, headY + Math.round(s * 0.6), checker ? turbanRedDark : c.turbanWhite)
  }

  // --- Face, by mood ---
  const faceY = headY + Math.round(headR * 0.15)
  const eyeDx = Math.max(1, Math.round(headR * 0.4))
  if (mood === 'panic') {
    p.px(headX - eyeDx, faceY - 2, ink)
    p.px(headX - eyeDx, faceY - 1, ink)
    p.px(headX + eyeDx, faceY - 2, ink)
    p.px(headX + eyeDx, faceY - 1, ink)
    p.px(headX, faceY + 1, ink)
    p.px(headX - 1, faceY + 2, ink)
    p.px(headX + 1, faceY + 2, ink)
  } else if (mood === 'sad') {
    p.px(headX - eyeDx, faceY, ink)
    p.px(headX + eyeDx, faceY, ink)
    p.px(headX - 1, faceY + 2, skinShade)
    p.px(headX, faceY + 3, skinShade)
    p.px(headX + 1, faceY + 2, skinShade)
  } else if (mood === 'happy') {
    p.px(headX - eyeDx, faceY, ink)
    p.px(headX + eyeDx, faceY, ink)
    p.px(headX - 1, faceY + 1, skinShade)
    p.px(headX, faceY + 2, skinShade)
    p.px(headX + 1, faceY + 1, skinShade)
  } else {
    p.px(headX - eyeDx, faceY, ink)
    p.px(headX + eyeDx, faceY, ink)
    p.px(headX - 1, faceY + 2, skinShade)
    p.px(headX, faceY + 2, skinShade)
    p.px(headX + 1, faceY + 2, skinShade)
  }

  // --- Arms ---
  const shoulderY = torsoTop
  if (mood === 'panic') {
    // Both arms thrown up in alarm — the phone call forgotten.
    for (let side = -1; side <= 1; side += 2) {
      const steps = Math.round(h * 0.22)
      for (let s = 0; s < steps; s++) {
        const tt = s / steps
        const ax = Math.round(x + side * (2 + tt * 3) + lean(0.6 + tt * 0.3))
        const ay = Math.round(shoulderY - tt * h * 0.24)
        p.px(ax, ay, tt > 0.7 ? skinShade : c.skin)
      }
    }
  } else {
    // One arm up with the phone at the ear.
    const earSteps = Math.round(h * 0.16)
    for (let s = 0; s < earSteps; s++) {
      const tt = s / earSteps
      const ax = Math.round(x - (headR + 1) + lean(0.7 + tt * 0.2))
      const ay = Math.round(shoulderY - tt * headR * 0.6)
      p.px(ax, ay, c.skin)
    }
    const phoneX = Math.round(x - (headR + 1) + lean(0.9))
    p.px(phoneX, headY, phoneBody)
    p.px(phoneX, headY + 1, c.phoneScreen)

    // Other arm holds a sample of the field's own crop — droopier for a sad
    // mood, raised a little livelier for a happy one.
    const dropFrac = mood === 'sad' ? 0.26 : mood === 'happy' ? 0.16 : 0.2
    const dropSteps = Math.round(h * dropFrac)
    let handX = x
    let handY = shoulderY
    for (let s = 0; s < dropSteps; s++) {
      const tt = s / dropSteps
      handX = Math.round(x + (2 + tt * 2) + lean(0.5 - tt * 0.2))
      handY = Math.round(shoulderY + tt * h * (mood === 'happy' ? 0.1 : 0.24))
      p.px(handX, handY, c.skin)
    }
    for (let b = -1; b <= 1; b++) {
      for (let y = 0; y < 5; y++) {
        p.px(handX + b, handY - y, c.crop)
      }
    }
  }
}
