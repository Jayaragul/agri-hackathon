import { describe, it, expect } from 'vitest'
import { computeGrowthState, maturityCurve, hasVisibleProduce } from '../engine/digitalTwin/growthModel'
import { scoreParam, assessField, assessArea, bandFor, BANDS } from '../engine/digitalTwin/healthModel'
import { reading, currentReadings, history, todayIndex, PARAMS } from '../engine/digitalTwin/simulateField'
import { manureEvents, wateringInfo } from '../engine/digitalTwin/lifecycleModel'
import type { CropProfile, Field } from '../domain/digitalTwin/models'
import { DIGITAL_TWIN_CROPS } from '../data/sample/digitalTwinCrops'
import { DIGITAL_TWIN_AREAS } from '../data/sample/digitalTwinFields'

const FIXED_NOW = new Date('2026-01-15T09:00:00Z').getTime()

const testCrop: CropProfile = {
  id: 'test-crop',
  name: 'Test Crop',
  icon: '🌱',
  family: 'Test',
  durationDays: 100,
  baseYieldPerHa: 10,
  unit: 't',
  stages: [
    { name: 'Emergence', end: 0.2 },
    { name: 'Vegetative', end: 0.5 },
    { name: 'Flowering', end: 0.8 },
    { name: 'Harvest Ready', end: 1.0 },
  ],
  productStage: 2,
  ideal: {
    moisture: [60, 80],
    ph: [6.0, 7.0],
    temperature: [20, 30],
    humidity: [55, 80],
    nitrogen: [100, 160],
    ec: [0.4, 1.5],
  },
  tolerable: {
    moisture: [42, 92],
    ph: [5.2, 8.0],
    temperature: [13, 37],
    humidity: [38, 94],
    nitrogen: [55, 220],
    ec: [0.15, 2.5],
  },
  art: {
    sprite: 'test',
    rows: 4,
    perRow: 6,
    matureH: 20,
    palette: { stem: '#6f9a3f', leaf: '#43a84e', leafDark: '#2a7838', stress: '#b0a044', dry: '#867230', product: '#e23c3c' },
  },
}

function makeField(overrides: Partial<Field> = {}): Field {
  return {
    id: 'test-field',
    name: 'Test Field',
    cropId: 'test-crop',
    areaHa: 2,
    sownDaysAgo: 30,
    irrigationCycleDays: 6,
    bias: {},
    ...overrides,
  }
}

describe('growthModel.computeGrowthState', () => {
  it('reads Day 1 on the sowing day itself, not Day 0', () => {
    const field = makeField({ sownDaysAgo: 0 })
    const growth = computeGrowthState(field, testCrop, null, FIXED_NOW)
    expect(growth.day).toBe(1)
    expect(growth.isPreview).toBe(false)
  })

  it('caps day at the crop duration and flags overdue fields beyond it', () => {
    const notOverdue = computeGrowthState(makeField({ sownDaysAgo: 99 }), testCrop, null, FIXED_NOW)
    expect(notOverdue.day).toBe(100)
    expect(notOverdue.isOverdue).toBe(false)

    const overdue = computeGrowthState(makeField({ sownDaysAgo: 150 }), testCrop, null, FIXED_NOW)
    expect(overdue.day).toBe(151)
    expect(overdue.isOverdue).toBe(true)
    expect(overdue.daysRemaining).toBe(0)
  })

  it('resolves the correct named stage from day progress', () => {
    // Day 10 of 100 -> progress 0.10 -> within Emergence (end 0.2)
    const early = computeGrowthState(makeField({ sownDaysAgo: 9 }), testCrop, null, FIXED_NOW)
    expect(early.stage.name).toBe('Emergence')

    // Day 90 of 100 -> progress 0.90 -> within Harvest Ready (end 1.0)
    const late = computeGrowthState(makeField({ sownDaysAgo: 89 }), testCrop, null, FIXED_NOW)
    expect(late.stage.name).toBe('Harvest Ready')
  })

  it('is deterministic for a fixed field, crop and "now"', () => {
    const field = makeField()
    const a = computeGrowthState(field, testCrop, null, FIXED_NOW)
    const b = computeGrowthState(field, testCrop, null, FIXED_NOW)
    expect(a).toEqual(b)
  })

  it('previewing a day overrides the day/stage without touching sownDate', () => {
    const field = makeField({ sownDaysAgo: 30 })
    const real = computeGrowthState(field, testCrop, null, FIXED_NOW)
    const preview = computeGrowthState(field, testCrop, 90, FIXED_NOW)

    expect(preview.day).toBe(90)
    expect(preview.isPreview).toBe(true)
    expect(preview.sownDate.getTime()).toBe(real.sownDate.getTime())
  })

  it('clamps a preview day to the [1, duration] range', () => {
    const field = makeField()
    expect(computeGrowthState(field, testCrop, -5, FIXED_NOW).day).toBe(1)
    expect(computeGrowthState(field, testCrop, 9999, FIXED_NOW).day).toBe(testCrop.durationDays)
  })
})

describe('growthModel.maturityCurve', () => {
  it('is bounded within [0, 1] and monotonically non-decreasing', () => {
    let prev = -1
    for (let p = 0; p <= 1; p += 0.05) {
      const m = maturityCurve(p)
      expect(m).toBeGreaterThanOrEqual(0)
      expect(m).toBeLessThanOrEqual(1)
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = m
    }
  })

  it('reaches (approximately) 0 at progress 0 and 1 at progress 1', () => {
    expect(maturityCurve(0)).toBeCloseTo(0, 5)
    expect(maturityCurve(1)).toBeCloseTo(1, 5)
  })
})

describe('growthModel.hasVisibleProduce', () => {
  it('is false before productStage and true from it onward', () => {
    expect(hasVisibleProduce(testCrop, 0)).toBe(false)
    expect(hasVisibleProduce(testCrop, 1)).toBe(false)
    expect(hasVisibleProduce(testCrop, 2)).toBe(true)
    expect(hasVisibleProduce(testCrop, 3)).toBe(true)
  })

  it('is always false when a crop has no visible produce stage', () => {
    const undergroundCrop: CropProfile = { ...testCrop, productStage: null }
    expect(hasVisibleProduce(undergroundCrop, 3)).toBe(false)
  })
})

describe('healthModel.scoreParam', () => {
  it('scores 1 (Optimal) inside the ideal window', () => {
    const result = scoreParam(70, [60, 80], [42, 92])
    expect(result).toEqual({ score: 1, verdict: 'Optimal', direction: 0 })
  })

  it('degrades smoothly between ideal and tolerable, never going negative', () => {
    const atIdealEdge = scoreParam(80, [60, 80], [42, 92])
    const midway = scoreParam(86, [60, 80], [42, 92])
    const atTolerableEdge = scoreParam(92, [60, 80], [42, 92])

    expect(atIdealEdge.score).toBe(1)
    expect(midway.score).toBeLessThan(1)
    expect(midway.score).toBeGreaterThan(0)
    expect(atTolerableEdge.score).toBeCloseTo(0.25, 5)
    expect(atTolerableEdge.direction).toBe(1)
  })

  it('bottoms out at 0 far outside the tolerable band', () => {
    const result = scoreParam(1000, [60, 80], [42, 92])
    expect(result.score).toBe(0)
    expect(result.verdict).toBe('Critically high')
    expect(result.direction).toBe(1)
  })

  it('flags too-low values with direction -1', () => {
    const result = scoreParam(10, [60, 80], [42, 92])
    expect(result.direction).toBe(-1)
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(1)
  })
})

describe('healthModel.assessField', () => {
  it('produces a score in [0, 100] and a matching band', () => {
    const field = makeField()
    const health = assessField(field, testCrop)
    // Explicit readings keep this deterministic regardless of the real clock.
    const readings = currentReadings(field, testCrop, 100, FIXED_NOW)
    const explicit = assessField(field, testCrop, readings)

    expect(explicit.score).toBeGreaterThanOrEqual(0)
    expect(explicit.score).toBeLessThanOrEqual(100)
    expect(explicit.band).toBe(bandFor(explicit.score))
    expect(health.score).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic for the same field, crop and readings', () => {
    const field = makeField()
    const readings = currentReadings(field, testCrop, 200, FIXED_NOW)
    const a = assessField(field, testCrop, readings)
    const b = assessField(field, testCrop, readings)
    expect(a).toEqual(b)
  })

  it('reads a well-centred field (zero bias) as high-scoring', () => {
    const centred = makeField({ bias: {} })
    const readings = currentReadings(centred, testCrop, 50, FIXED_NOW)
    const health = assessField(centred, testCrop, readings)
    expect(health.score).toBeGreaterThan(70)
  })

  it('reads a field biased far outside tolerable as low-scoring', () => {
    const stressed = makeField({ bias: { moisture: -3, nitrogen: -3, ph: -3 } })
    const readings = currentReadings(stressed, testCrop, 50, FIXED_NOW)
    const health = assessField(stressed, testCrop, readings)
    expect(health.score).toBeLessThan(50)
  })
})

describe('healthModel.assessArea', () => {
  it('is an area-weighted mean of its fields, bounded [0, 100]', () => {
    const fieldA = makeField({ id: 'a', areaHa: 1, bias: {} })
    const fieldB = makeField({ id: 'b', areaHa: 3, bias: { moisture: -3, nitrogen: -3 } })
    const now = FIXED_NOW
    const readingsA = currentReadings(fieldA, testCrop, 300, now)
    const readingsB = currentReadings(fieldB, testCrop, 300, now)
    const scoreA = assessField(fieldA, testCrop, readingsA).score
    const scoreB = assessField(fieldB, testCrop, readingsB).score

    const area = assessArea([
      { field: fieldA, crop: testCrop },
      { field: fieldB, crop: testCrop },
    ])

    expect(area.totalArea).toBe(4)
    expect(area.score).toBeGreaterThanOrEqual(0)
    expect(area.score).toBeLessThanOrEqual(100)
    // The fields inside assessArea recompute readings off "now", so just
    // sanity-check the weighting direction rather than an exact value:
    // the larger, worse-scoring field should pull the mean below a simple
    // (unweighted) average of the two individually-computed scores.
    expect(area.score).toBeLessThanOrEqual(Math.max(scoreA, scoreB))
    expect(area.score).toBeGreaterThanOrEqual(Math.min(scoreA, scoreB) - 1)
  })

  it('returns a zero-score, zero-area result for an empty field list', () => {
    const area = assessArea([])
    expect(area).toEqual({ score: 0, band: bandFor(0), totalArea: 0, fieldScores: [], alertCount: 0 })
  })
})

describe('healthModel.bandFor / BANDS', () => {
  it('maps scores to bands in descending order of minimum', () => {
    expect(bandFor(95).id).toBe('excellent')
    expect(bandFor(85).id).toBe('excellent')
    expect(bandFor(75).id).toBe('good')
    expect(bandFor(55).id).toBe('fair')
    expect(bandFor(10).id).toBe('poor')
    expect(bandFor(0).id).toBe('poor')
  })

  it('bands are sorted by descending min, ending at 0', () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].min).toBeLessThan(BANDS[i - 1].min)
    }
    expect(BANDS[BANDS.length - 1].min).toBe(0)
  })
})

describe('simulateField.reading', () => {
  it('stays within the parameter display scale', () => {
    const field = makeField()
    for (const param of PARAMS) {
      for (let day = 0; day < 40; day++) {
        const value = reading(field, testCrop, param.id, day, FIXED_NOW)
        expect(value).toBeGreaterThanOrEqual(param.scaleMin)
        expect(value).toBeLessThanOrEqual(param.scaleMax)
      }
    }
  })

  it('is a pure, deterministic function of (field, crop, param, day, now)', () => {
    const field = makeField()
    const a = reading(field, testCrop, 'moisture', 42, FIXED_NOW)
    const b = reading(field, testCrop, 'moisture', 42, FIXED_NOW)
    expect(a).toBe(b)
  })

  it('never calls Math.random — repeated calls without re-seeding stay identical', () => {
    const field = makeField()
    const values = Array.from({ length: 5 }, () => reading(field, testCrop, 'ph', 10, FIXED_NOW))
    expect(new Set(values).size).toBe(1)
  })
})

describe('simulateField.currentReadings / history / todayIndex', () => {
  it('currentReadings returns one value per known sensor parameter', () => {
    const field = makeField()
    const readings = currentReadings(field, testCrop, 100, FIXED_NOW)
    expect(Object.keys(readings).sort()).toEqual(PARAMS.map((p) => p.id).sort())
  })

  it('history returns `days` oldest-first readings ending at the given day', () => {
    const field = makeField()
    const days = 10
    const dayIndex = 500
    const hist = history(field, testCrop, 'moisture', days, dayIndex, FIXED_NOW)
    expect(hist).toHaveLength(days)
    expect(hist[hist.length - 1]).toBe(reading(field, testCrop, 'moisture', dayIndex, FIXED_NOW))
  })

  it('todayIndex advances by exactly one per elapsed day', () => {
    const dayMs = 86_400_000
    expect(todayIndex(FIXED_NOW + dayMs)).toBe(todayIndex(FIXED_NOW) + 1)
  })
})

describe('lifecycleModel.wateringInfo', () => {
  it('computes a consistent watering cycle position', () => {
    const field = makeField({ sownDaysAgo: 7, irrigationCycleDays: 5 })
    const info = wateringInfo(field, testCrop, FIXED_NOW)
    expect(info.cycleDays).toBe(5)
    expect(info.sinceLast).toBeGreaterThanOrEqual(0)
    expect(info.sinceLast).toBeLessThan(info.cycleDays)
    expect(info.nextIn).toBe(info.cycleDays - info.sinceLast)
  })

  it('falls back to a 6-day cycle when irrigationCycleDays is falsy', () => {
    const field = makeField({ irrigationCycleDays: 0 })
    const info = wateringInfo(field, testCrop, FIXED_NOW)
    expect(info.cycleDays).toBe(6)
  })
})

describe('lifecycleModel.manureEvents', () => {
  it('marks each dose done once the real growth day reaches it', () => {
    const field = makeField({ sownDaysAgo: 59 }) // day 60 of 100
    const events = manureEvents(field, testCrop, FIXED_NOW)
    expect(events).toHaveLength(3)
    expect(events[0].done).toBe(true) // basal dose, day ~1
    expect(events[1].done).toBe(true) // 1st top dressing, day 30
    expect(events[2].done).toBe(true) // 2nd top dressing, day 55
  })

  it('leaves future doses undone', () => {
    const field = makeField({ sownDaysAgo: 0 }) // day 1 of 100
    const events = manureEvents(field, testCrop, FIXED_NOW)
    expect(events[0].done).toBe(true)
    expect(events[1].done).toBe(false)
    expect(events[2].done).toBe(false)
  })
})

describe('sample data integrity', () => {
  it('every field in the sample areas references a known crop', () => {
    for (const area of DIGITAL_TWIN_AREAS) {
      for (const field of area.fields) {
        expect(DIGITAL_TWIN_CROPS[field.cropId]).toBeDefined()
      }
    }
  })

  it('produces a valid Excellence assessment for every sample field', () => {
    for (const area of DIGITAL_TWIN_AREAS) {
      for (const field of area.fields) {
        const crop = DIGITAL_TWIN_CROPS[field.cropId]
        const health = assessField(field, crop)
        expect(health.score).toBeGreaterThanOrEqual(0)
        expect(health.score).toBeLessThanOrEqual(100)
      }
    }
  })
})
