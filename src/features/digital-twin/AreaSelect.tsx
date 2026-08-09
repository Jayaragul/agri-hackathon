// Screen 1 — "Which area do you want to watch?"
//
// Every branch card carries a live pixel thumbnail of its largest field, so
// the choice is visual rather than a wall of names: you can see at a glance
// which branch is growing tall cane and which is a struggling rainfed
// cotton block.
//
// Ported from FieldWatch's `ui/areaSelect.js`. All scores/growth shown here
// come straight from `engine/digitalTwin/*` — this component only lays out
// what the engine decided.

import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { DIGITAL_TWIN_AREAS } from '../../data/sample/digitalTwinFields'
import { getDigitalTwinCrop } from '../../data/sample/digitalTwinCrops'
import { assessArea, type AreaAssessment } from '../../engine/digitalTwin/healthModel'
import { computeGrowthState } from '../../engine/digitalTwin/growthModel'
import { buildCommunityAlerts } from '../../engine/communityPestAlerts'
import { getCommunityNetwork } from '../../services/community/communityClient'
import { PixelThumbnail } from './pixel/PixelCanvas'
import { LiveMap } from './LiveMap'
import { CommunityAlerts } from './CommunityAlerts'
import type { Field, MonitoringArea } from '../../domain/digitalTwin/models'
import type { SimulatedCommunityFarmer } from '../../domain/digitalTwin/communityModels'

interface AreaSummary {
  area: MonitoringArea
  summary: AreaAssessment
}

/** Distinct crops in an area, largest area first — used for the card's crop chips. */
function cropMix(area: MonitoringArea) {
  const byCrop = new Map<string, number>()
  area.fields.forEach((f) => {
    byCrop.set(f.cropId, (byCrop.get(f.cropId) || 0) + f.areaHa)
  })
  return [...byCrop.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cropId]) => getDigitalTwinCrop(cropId))
    .filter((c): c is NonNullable<typeof c> => c != null)
}

function headlineField(area: MonitoringArea): Field {
  return [...area.fields].sort((a, b) => b.areaHa - a.areaHa)[0]
}

export interface AreaSelectProps {
  onPick: (areaId: string) => void
}

export function AreaSelect({ onPick }: AreaSelectProps) {
  const [query, setQuery] = useState('')
  const [communityFarmers, setCommunityFarmers] = useState<SimulatedCommunityFarmer[]>([])
  const [communityLoading, setCommunityLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    getCommunityNetwork()
      .then((network) => {
        if (!cancelled) setCommunityFarmers(network.farmers)
      })
      .finally(() => {
        if (!cancelled) setCommunityLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const communityAlerts = useMemo(() => buildCommunityAlerts(DIGITAL_TWIN_AREAS, communityFarmers), [communityFarmers])

  const summaries = useMemo<AreaSummary[]>(
    () =>
      DIGITAL_TWIN_AREAS.map((area) => ({
        area,
        summary: assessArea(
          area.fields.map((field) => ({ field, crop: getDigitalTwinCrop(field.cropId)! }))
        ),
      })),
    []
  )

  const totalFields = DIGITAL_TWIN_AREAS.reduce((s, a) => s + a.fields.length, 0)
  const totalHa = summaries.reduce((s, x) => s + x.summary.totalArea, 0)
  const alerts = summaries.reduce((s, x) => s + (x.summary.alertCount || 0), 0)

  const q = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!q) return summaries
    return summaries.filter(({ area }) => {
      const haystack = [
        area.name,
        area.taluk,
        ...area.fields.map((f) => f.name),
        ...area.fields.map((f) => getDigitalTwinCrop(f.cropId)?.name ?? ''),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [q, summaries])

  const visibleIds = q ? new Set(visible.map(({ area }) => area.id)) : null

  return (
    <div className="dt-select-screen">
      <div className="dt-select-inner">
        <div className="dt-select-hero">
          <header className="dt-select-head">
            <div className="dt-brand-row">
              <span className="dt-brand-logo">▚</span>
              <span className="dt-brand-name">DIGITAL TWIN</span>
              <span className="dt-brand-sub">Coimbatore District · Crop Monitoring</span>
            </div>

            <h2 className="dt-select-title">Which area do you want to watch?</h2>
            <p className="dt-select-lede">
              Pick a branch to open its live monitoring station — growth day, soil moisture, pH,
              nutrients and an overall excellence score for every field.
            </p>

            <div className="dt-select-stats">
              <span>
                <b>{DIGITAL_TWIN_AREAS.length}</b> branches
              </span>
              <span className="dt-dot">·</span>
              <span>
                <b>{totalFields}</b> fields
              </span>
              <span className="dt-dot">·</span>
              <span>
                <b>{totalHa.toFixed(1)}</b> hectares
              </span>
              {alerts > 0 && (
                <>
                  <span className="dt-dot">·</span>
                  <span className="dt-stat-alert">
                    <b>{alerts}</b> need attention
                  </span>
                </>
              )}
            </div>

            <div className="dt-search-wrap">
              <Search size={16} className="dt-search-icon" aria-hidden="true" />
              <input
                className="dt-search-input"
                type="text"
                placeholder="Search branch, taluk or crop…"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (visible.length === 1) onPick(visible[0].area.id)
                }}
              />
            </div>
          </header>

          <LiveMap areas={DIGITAL_TWIN_AREAS} onPick={onPick} visibleAreaIds={visibleIds} communityFarmers={communityFarmers} />
        </div>

        <CommunityAlerts alerts={communityAlerts} loading={communityLoading} />

        <div className="dt-area-grid">
          {visible.map(({ area, summary }) => {
            const crops = cropMix(area)
            const hero = headlineField(area)
            const heroCrop = getDigitalTwinCrop(hero.cropId)!
            const heroHealth = summary.fieldScores.find((fs) => fs.field.id === hero.id)!
            const heroGrowth = computeGrowthState(hero, heroCrop)
            const band = summary.band

            return (
              <button key={area.id} className="dt-area-card" onClick={() => onPick(area.id)}>
                <div className="dt-area-thumb">
                  <PixelThumbnail field={hero} crop={heroCrop} health={heroHealth} className="dt-thumb-canvas" />
                  <span className="dt-thumb-crop">
                    {heroCrop.icon} {heroCrop.name}
                  </span>
                  <span className="dt-thumb-day">D{heroGrowth.day}</span>
                </div>

                <div className="dt-area-body">
                  <div className="dt-area-head">
                    <div>
                      <div className="dt-area-name">{area.name}</div>
                      <div className="dt-area-taluk">{area.taluk}</div>
                    </div>
                    <div className="dt-area-score" style={{ ['--band' as string]: band.color }}>
                      <svg viewBox="0 0 36 36" className="dt-score-ring" aria-hidden="true">
                        <circle cx={18} cy={18} r={15.5} className="dt-ring-track" />
                        <circle
                          cx={18}
                          cy={18}
                          r={15.5}
                          className="dt-ring-fill"
                          stroke={band.color}
                          strokeDasharray={`${((summary.score / 100) * 97.4).toFixed(1)} 97.4`}
                          transform="rotate(-90 18 18)"
                        />
                      </svg>
                      <span className="dt-score-num">
                        {summary.score}
                        <i>%</i>
                      </span>
                    </div>
                  </div>

                  <div className="dt-area-meta">
                    <span>
                      {area.fields.length} field{area.fields.length > 1 ? 's' : ''}
                    </span>
                    <span className="dt-dot">·</span>
                    <span>{summary.totalArea.toFixed(1)} ha</span>
                    <span className="dt-band-tag" style={{ ['--band' as string]: band.color }}>
                      {band.label}
                    </span>
                  </div>

                  <div className="dt-crop-chips">
                    {crops.slice(0, 4).map((c) => (
                      <span key={c.id} className="dt-crop-chip" title={c.name}>
                        {c.icon}
                      </span>
                    ))}
                    {crops.length > 4 && <span className="dt-crop-chip dt-more">+{crops.length - 4}</span>}
                  </div>

                  {summary.alertCount > 0 ? (
                    <div className="dt-area-alert">
                      ⚠ {summary.alertCount} field{summary.alertCount > 1 ? 's' : ''} below 50%
                    </div>
                  ) : (
                    <div className="dt-area-ok">✓ All fields within tolerance</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
        {visible.length === 0 && <div className="dt-no-results">No branch matches that search.</div>}
      </div>
    </div>
  )
}
