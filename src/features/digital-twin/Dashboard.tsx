// Screen 2 — the field monitoring station.
//
// Layout priority, top to bottom: what am I looking at -> how far along is
// it -> how good is it -> why. The pixel scene answers the first two
// visually before you read a single number, the Excellence donut answers
// the third, and the gauge rail answers the fourth.
//
// Gauge design note: each parameter is a horizontal track with the crop's
// TOLERABLE span as the outer bar, its IDEAL window highlighted inside, and
// a needle at the live reading. That makes "is this where it should be?" a
// pre-attentive judgement — you see the needle sitting inside or outside the
// good band without reading any digits.
//
// Every number and stage name on this screen comes from
// `engine/digitalTwin/*` via `useDigitalTwinStore`'s snapshot — this
// component only renders what the engine already decided. Ported from
// FieldWatch's `ui/dashboard.js`.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useDigitalTwinStore } from '../../state/digitalTwinStore'
import { getDigitalTwinCrop } from '../../data/sample/digitalTwinCrops'
import { computeGrowthState, type GrowthState } from '../../engine/digitalTwin/growthModel'
import { assessField } from '../../engine/digitalTwin/healthModel'
import { manureEvents, wateringInfo } from '../../engine/digitalTwin/lifecycleModel'
import { PARAMS, history } from '../../engine/digitalTwin/simulateField'
import type { CropProfile, Field } from '../../domain/digitalTwin/models'
import { PixelSceneCanvas } from './pixel/PixelCanvas'
import { SEASONS, type PixelScene } from './pixel/pixelScene'

const SEASON_OPTIONS = [{ id: '', name: 'Auto (today)' }, ...Object.values(SEASONS).map((s) => ({ id: s.id, name: s.name }))]

function fmt(value: number, decimals: number): string {
  return Number(value).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Maps a value onto 0-100% of a gauge's display scale. */
function pos(value: number, scaleMin: number, scaleMax: number): number {
  return Math.max(0, Math.min(100, ((value - scaleMin) / (scaleMax - scaleMin)) * 100))
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100
      const y = 22 - ((v - min) / span) * 20 - 1
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="dt-spark" viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

interface GaugeRowProps {
  field: Field
  crop: CropProfile
}

function GaugeRail({ field, crop }: GaugeRowProps) {
  const health = useMemo(() => assessField(field, crop), [field, crop])

  return (
    <div className="dt-gauges">
      {health.params.map((entry) => {
        const { param, value, score, verdict, direction, ideal, tolerable } = entry
        const trend = history(field, crop, param.id, 21)

        const idealLeft = pos(ideal[0], param.scaleMin, param.scaleMax)
        const idealWidth = pos(ideal[1], param.scaleMin, param.scaleMax) - idealLeft
        const tolLeft = pos(tolerable[0], param.scaleMin, param.scaleMax)
        const tolWidth = pos(tolerable[1], param.scaleMin, param.scaleMax) - tolLeft
        const needle = pos(value, param.scaleMin, param.scaleMax)

        const tone = direction === 0 ? 'ok' : score >= 0.6 ? 'warn' : 'bad'
        const arrow = direction === 0 ? '' : direction < 0 ? '↓' : '↑'
        const sparkColor = tone === 'ok' ? '#3fd77f' : tone === 'warn' ? '#f0b429' : '#f2545b'

        return (
          <div key={param.id} className={`dt-gauge dt-gauge-${tone}`}>
            <div className="dt-gauge-top">
              <span className="dt-gauge-icon">{param.icon}</span>
              <span className="dt-gauge-label">{param.label}</span>
              <span className="dt-gauge-verdict">
                {arrow} {verdict}
              </span>
            </div>

            <div className="dt-gauge-readout">
              <span className="dt-gauge-value">
                {fmt(value, param.decimals)}
                <i>{param.unit}</i>
              </span>
              <Sparkline values={trend} color={sparkColor} />
            </div>

            <div className="dt-gauge-track">
              <span className="dt-track-tolerable" style={{ left: `${tolLeft}%`, width: `${tolWidth}%` }} />
              <span className="dt-track-ideal" style={{ left: `${idealLeft}%`, width: `${idealWidth}%` }} />
              <span className="dt-track-needle" style={{ left: `${needle}%` }} />
            </div>

            <div className="dt-gauge-foot">
              <span>
                ideal {fmt(ideal[0], param.decimals)}–{fmt(ideal[1], param.decimals)}
                {param.unit}
              </span>
              <span className="dt-gauge-score">
                {Math.round(score * 100)}
                <i>/100</i>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LifecycleTimeline({ growth, field, crop }: { growth: GrowthState; field: Field; crop: CropProfile }) {
  const water = wateringInfo(field, crop)
  const manure = manureEvents(field, crop)

  return (
    <div className="dt-lifecycle">
      <div className="dt-lc-row dt-lc-stages">
        <span className="dt-lc-label">🌱 Growth</span>
        <div className="dt-lc-track">
          <div className="dt-tl-segs">
            {growth.stages.map((stage, i) => {
              const start = i === 0 ? 0 : growth.stages[i - 1].end
              const width = (stage.end - start) * 100
              const state = i < growth.stageIndex ? 'done' : i === growth.stageIndex ? 'active' : 'todo'
              return (
                <div key={stage.name} className={`dt-tl-seg dt-tl-${state}`} style={{ flex: width }}>
                  <span className="dt-tl-bar" />
                  <span className="dt-tl-name">{stage.name}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="dt-lc-row dt-lc-watering">
        <span className="dt-lc-label">💧 Watering</span>
        <div className="dt-lc-track">
          <div className="dt-lc-ticks" style={{ backgroundSize: `${water.cyclePct.toFixed(2)}% 100%` }} />
        </div>
        <span className="dt-lc-note">
          every {water.cycleDays}d · next in {water.nextIn}d
        </span>
      </div>

      <div className="dt-lc-row dt-lc-manure">
        <span className="dt-lc-label">🌿 Manure</span>
        <div className="dt-lc-track">
          {manure.map((m) => (
            <span
              key={m.label}
              className={`dt-lc-point${m.done ? ' dt-done' : ''}`}
              style={{ left: `${(m.at * 100).toFixed(2)}%` }}
              title={`${m.label} · Day ${m.day}`}
            >
              {m.icon}
            </span>
          ))}
        </div>
      </div>

      <span
        className="dt-lc-cursor"
        style={{
          left: `calc(var(--lc-label) + var(--lc-gap) + (100% - var(--lc-label) - var(--lc-note) - var(--lc-gap) * 2) * ${growth.progress.toFixed(4)})`,
        }}
      >
        <i />
      </span>
    </div>
  )
}

export interface DashboardProps {
  onBack: () => void
}

export function Dashboard({ onBack }: DashboardProps) {
  const { snapshot, dayOverride, seasonOverride, selectField, previewDay, previewSeason, resetPreview, advanceDay } =
    useDigitalTwinStore()

  const sceneRef = useRef<PixelScene | null>(null)
  const [hud, setHud] = useState({ phase: '', season: '', moodEmoji: '🙂', moodLabel: 'Content' })
  const [clock, setClock] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 10_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const scene = sceneRef.current
      if (!scene) return
      const mood = scene.farmerMood
      setHud({ phase: scene.phase, season: scene.season, moodEmoji: mood.emoji, moodLabel: mood.label })
    }, 2000)
    return () => clearInterval(id)
  }, [snapshot])

  if (!snapshot) return null

  const { area, field, growth, health } = snapshot
  const crop = getDigitalTwinCrop(field.cropId)!
  const band = health.band
  const donutCirc = 2 * Math.PI * 42
  const expectedYield = crop.baseYieldPerHa * field.areaHa * (health.score / 100)

  return (
    <div className="dt-dash">
      <header className="dt-dash-bar">
        <button className="dt-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> All areas
        </button>
        <div className="dt-dash-titles">
          <div className="dt-dash-area">{area.name}</div>
          <div className="dt-dash-taluk">
            {area.taluk} · {area.fields.length} fields monitored
          </div>
        </div>
        <div className="dt-dash-clock">
          <div className="dt-clock-time">
            {clock.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </div>
          <div className="dt-clock-date">
            {clock.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
          </div>
        </div>
      </header>

      <nav className="dt-field-tabs" role="tablist">
        {area.fields.map((f) => {
          const fCrop = getDigitalTwinCrop(f.cropId)!
          const fHealth = assessField(f, fCrop)
          const fGrowth = computeGrowthState(f, fCrop)
          const active = f.id === field.id
          return (
            <button
              key={f.id}
              className={`dt-field-tab${active ? ' dt-active' : ''}`}
              role="tab"
              aria-selected={active}
              onClick={() => selectField(area.id, f.id)}
            >
              <span className="dt-tab-icon">{fCrop.icon}</span>
              <span className="dt-tab-text">
                <b>{f.name}</b>
                <i>
                  Day {fGrowth.day} · {f.areaHa} ha
                </i>
              </span>
              <span className="dt-tab-score" style={{ ['--band' as string]: fHealth.band.color }}>
                {fHealth.score}%
              </span>
            </button>
          )
        })}
      </nav>

      <div className="dt-dash-grid">
        <section className="dt-scene-col">
          <div className="dt-scene-frame">
            <PixelSceneCanvas
              field={field}
              crop={crop}
              health={health}
              dayOverride={dayOverride}
              seasonOverride={seasonOverride}
              className="dt-field-scene"
              onSceneChange={(scene) => {
                sceneRef.current = scene
                if (scene) setHud({ phase: scene.phase, season: scene.season, moodEmoji: scene.farmerMood.emoji, moodLabel: scene.farmerMood.label })
              }}
            />
            <div className="dt-scene-scan" aria-hidden="true" />

            <div className="dt-scene-hud">
              <div className="dt-hud-left">
                <span className="dt-hud-day">DAY {growth.day}</span>
                <span className="dt-hud-of">of {growth.duration}</span>
                {growth.isPreview && <span className="dt-hud-preview">PREVIEW</span>}
              </div>
              <div className="dt-hud-right">
                <span className="dt-hud-stage">{growth.stage.name}</span>
                <span className="dt-hud-band" style={{ ['--band' as string]: band.color }}>
                  {health.score}% {band.label}
                </span>
              </div>
            </div>

            <div className="dt-scene-caption">
              <span>
                {crop.icon} {crop.name}
              </span>
              <span className="dt-dot">·</span>
              <span>{field.name}</span>
              <span className="dt-dot">·</span>
              <span>{hud.phase}</span>
              <span className="dt-dot">·</span>
              <span className="dt-scene-season">{hud.season}</span>
              <span className="dt-dot">·</span>
              <span className="dt-farmer-mood">
                {hud.moodEmoji} Farmer: {hud.moodLabel}
              </span>
            </div>
          </div>

          <LifecycleTimeline growth={growth} field={field} crop={crop} />

          <div className="dt-preview-bar">
            <span className="dt-preview-label">⏵ Preview</span>

            <label className="dt-preview-field">
              <span>Climate</span>
              <select value={seasonOverride ?? ''} onChange={(e) => previewSeason(e.target.value || null)}>
                {SEASON_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="dt-preview-field dt-preview-day">
              <span>
                Day {growth.day} · {growth.stage.name}
              </span>
              <input
                type="range"
                min={1}
                max={growth.duration}
                step={1}
                value={growth.day}
                onChange={(e) => previewDay(Number(e.target.value))}
              />
            </label>

            <button className="dt-preview-reset" disabled={!dayOverride && !seasonOverride} onClick={resetPreview}>
              Reset
            </button>

            <button className="dt-advance-btn" onClick={() => advanceDay(1)} title="Advance the simulated clock by one day">
              ⏭ Advance 1 day
            </button>
          </div>

          <div className="dt-cycle-row">
            <div className="dt-cycle-card">
              <span className="dt-cc-k">Sown</span>
              <span className="dt-cc-v">
                {growth.sownDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <div className="dt-cycle-card">
              <span className="dt-cc-k">Stage</span>
              <span className="dt-cc-v">{growth.stage.name}</span>
            </div>
            <div className="dt-cycle-card">
              <span className="dt-cc-k">{growth.isOverdue ? 'Overdue by' : 'Days to harvest'}</span>
              <span className="dt-cc-v">{growth.isOverdue ? `${growth.day - growth.duration} d` : `${growth.daysRemaining} d`}</span>
            </div>
            <div className="dt-cycle-card">
              <span className="dt-cc-k">Est. harvest</span>
              <span className="dt-cc-v">
                {growth.harvestDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
        </section>

        <aside className="dt-metrics-col">
          <div className="dt-excellence" style={{ ['--band' as string]: band.color }}>
            <svg viewBox="0 0 100 100" className="dt-donut" aria-hidden="true">
              <circle cx={50} cy={50} r={42} className="dt-donut-track" />
              <circle
                cx={50}
                cy={50}
                r={42}
                className="dt-donut-fill"
                stroke={band.color}
                strokeDasharray={`${((health.score / 100) * donutCirc).toFixed(1)} ${donutCirc.toFixed(1)}`}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="dt-ex-center">
              <span className="dt-ex-num">
                {health.score}
                <i>%</i>
              </span>
              <span className="dt-ex-band">{band.label}</span>
            </div>
          </div>

          <div className="dt-ex-summary">
            <div className="dt-ex-line">
              <b>{health.optimalCount}</b> of {health.params.length} readings in the ideal window
            </div>
            {health.worst ? (
              <div className="dt-ex-worst">
                Weakest link — <b>{health.worst.param.label}</b> {health.worst.direction < 0 ? 'below' : 'above'} ideal
              </div>
            ) : (
              <div className="dt-ex-worst dt-good">Every parameter on target</div>
            )}
            <div className="dt-ex-yield">
              Tracking{' '}
              <b>
                {expectedYield.toLocaleString('en-IN', { maximumFractionDigits: 1 })} {crop.unit}
              </b>{' '}
              across {field.areaHa} ha at this score
            </div>
          </div>

          <div className="dt-metrics-head">
            <span>Live Sensors</span>
            <span className="dt-metrics-hint">21-day trend</span>
          </div>

          <GaugeRail field={field} crop={crop} />

          <p className="dt-metrics-note">
            Excellence is the weighted mean of these six scores. Soil moisture and pH carry the most weight — they
            gate nutrient uptake and are the levers you can actually pull.
          </p>
        </aside>
      </div>
    </div>
  )
}
