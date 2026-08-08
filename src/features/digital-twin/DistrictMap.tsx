// A true-to-scale map of every branch across Coimbatore district.
//
// Positions are NOT laid out by eye — each branch carries a real lat/lon
// (sourced from published gazetteer coordinates). This projects those onto a
// flat plane with the longitude axis corrected by cos(latitude), so
// on-screen distance tracks true ground distance across the ~60 km the
// branches span, and reports each branch's real distance and compass
// bearing from Coimbatore city centre.
//
// Ported from FieldWatch's `ui/districtMap.js` into an SVG React component.
// The Excellence scores it colors nodes by come entirely from
// `engine/digitalTwin/healthModel.assessArea` — this component only lays
// out and paints what the engine already decided.

import { useMemo } from 'react'
import type { MonitoringArea } from '../../domain/digitalTwin/models'
import { assessArea } from '../../engine/digitalTwin/healthModel'
import { getDigitalTwinCrop } from '../../data/sample/digitalTwinCrops'

const KM_PER_DEG_LAT = 110.574
const kmPerDegLon = (latDeg: number) => 111.32 * Math.cos((latDeg * Math.PI) / 180)

// The fixed reference point every branch's distance/bearing is measured against.
const CITY = { name: 'Coimbatore', lat: 11.0168, lon: 76.9558 }

const PX_PER_KM = 11
const PAD_KM = 6
const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

function bearingLabel(deg: number): string {
  return DIRS[Math.round(deg / 22.5) % 16]
}

interface MapPoint {
  area: MonitoringArea
  dxKm: number
  dyKm: number
  distKm: number
  bearing: number
  px: number
  py: number
}

function buildLayout(areas: MonitoringArea[]) {
  const kmLon = kmPerDegLon(CITY.lat)
  const toKm = (lat: number, lon: number) => ({ x: lon * kmLon, y: lat * KM_PER_DEG_LAT })
  const cityKm = toKm(CITY.lat, CITY.lon)

  const raw = areas.map((area) => {
    const km = toKm(area.coords[0], area.coords[1])
    const dxKm = km.x - cityKm.x
    const dyKm = km.y - cityKm.y
    return {
      area,
      dxKm,
      dyKm,
      distKm: Math.hypot(dxKm, dyKm),
      bearing: ((Math.atan2(dxKm, dyKm) * 180) / Math.PI + 360) % 360,
    }
  })

  const xs = raw.map((p) => p.dxKm).concat(0)
  const ys = raw.map((p) => p.dyKm).concat(0)
  const minX = Math.min(...xs) - PAD_KM
  const maxX = Math.max(...xs) + PAD_KM
  const minY = Math.min(...ys) - PAD_KM
  const maxY = Math.max(...ys) + PAD_KM

  const W = (maxX - minX) * PX_PER_KM
  const H = (maxY - minY) * PX_PER_KM

  // North (larger dyKm) must render higher up, so the Y axis flips here.
  const project = (dxKm: number, dyKm: number) => ({
    px: (dxKm - minX) * PX_PER_KM,
    py: (maxY - dyKm) * PX_PER_KM,
  })

  const city = { ...project(0, 0), name: CITY.name }
  const points: MapPoint[] = raw.map((p) => ({ ...p, ...project(p.dxKm, p.dyKm) }))

  return { W, H, city, points }
}

export interface DistrictMapProps {
  areas: MonitoringArea[]
  onPick: (areaId: string) => void
  /** Restrict which nodes render at full opacity (search filtering); null = all visible. */
  visibleAreaIds?: Set<string> | null
}

export function DistrictMap({ areas, onPick, visibleAreaIds = null }: DistrictMapProps) {
  const { W, H, city, points } = useMemo(() => buildLayout(areas), [areas])
  const ringsKm = [10, 20, 30, 40].filter((r) => r * PX_PER_KM < Math.max(W, H) * 0.7)
  const scaleKm = 10
  const scalePx = scaleKm * PX_PER_KM

  return (
    <div className="dmap-panel">
      <div className="dmap-head">
        <span className="dmap-title">
          <i>▚</i> District Map
        </span>
        <span className="dmap-sub">True-scale · real distance from Coimbatore city centre</span>
      </div>
      <div className="dmap-stage">
        <svg
          className="dmap-svg"
          viewBox={`0 0 ${W.toFixed(1)} ${H.toFixed(1)}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Map of monitoring branches across Coimbatore district, positioned by real coordinates"
        >
          <defs>
            <radialGradient id="dmapGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#5ee08a" stopOpacity={0.85} />
              <stop offset="100%" stopColor="#5ee08a" stopOpacity={0} />
            </radialGradient>
          </defs>

          {ringsKm.map((r) => (
            <g key={r}>
              <circle className="dmap-ring" cx={city.px} cy={city.py} r={r * PX_PER_KM} />
              <text className="dmap-ring-label" x={city.px + 5} y={(city.py - r * PX_PER_KM + 11).toFixed(1)}>
                {r} km
              </text>
            </g>
          ))}

          <line className="dmap-cross" x1={city.px} y1={0} x2={city.px} y2={H} />
          <line className="dmap-cross" x1={0} y1={city.py} x2={W} y2={city.py} />

          {points.map((p) => (
            <line key={p.area.id} className="dmap-spoke" x1={city.px} y1={city.py} x2={p.px} y2={p.py} />
          ))}

          {points.map((p) => {
            const summary = assessArea(
              p.area.fields.map((field) => ({ field, crop: getDigitalTwinCrop(field.cropId)! }))
            )
            const dim = visibleAreaIds != null && !visibleAreaIds.has(p.area.id)
            return (
              <g
                key={p.area.id}
                className={`dmap-node${dim ? ' dim' : ''}`}
                tabIndex={0}
                role="button"
                aria-label={`${p.area.name}, ${summary.score} percent excellence, ${p.distKm.toFixed(1)} kilometres ${bearingLabel(p.bearing)} of Coimbatore`}
                onClick={() => onPick(p.area.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onPick(p.area.id)
                }}
              >
                <circle
                  className="dmap-pulse"
                  cx={p.px.toFixed(1)}
                  cy={p.py.toFixed(1)}
                  r={9}
                  style={{ ['--band' as string]: summary.band.color }}
                />
                <circle
                  className="dmap-dot"
                  cx={p.px.toFixed(1)}
                  cy={p.py.toFixed(1)}
                  r={4.5}
                  style={{ ['--band' as string]: summary.band.color }}
                />
                <text className="dmap-label" x={p.px.toFixed(1)} y={(p.py - 12).toFixed(1)} textAnchor="middle">
                  {p.area.name.replace(' Branch', '')}
                </text>
                <text className="dmap-dist" x={p.px.toFixed(1)} y={(p.py + 18).toFixed(1)} textAnchor="middle">
                  {p.distKm.toFixed(1)} km {bearingLabel(p.bearing)}
                </text>
              </g>
            )
          })}

          <g className="dmap-city">
            <circle cx={city.px} cy={city.py} r={15} fill="url(#dmapGlow)" />
            <rect x={(city.px - 4.5).toFixed(1)} y={(city.py - 4.5).toFixed(1)} width={9} height={9} rx={2} />
            <text x={city.px} y={(city.py + 20).toFixed(1)} textAnchor="middle" className="dmap-city-label">
              COIMBATORE
            </text>
          </g>

          <g className="dmap-scale" transform={`translate(14, ${(H - 16).toFixed(1)})`}>
            <line x1={0} y1={0} x2={scalePx} y2={0} />
            <line x1={0} y1={-4} x2={0} y2={4} />
            <line x1={scalePx} y1={-4} x2={scalePx} y2={4} />
            <text x={(scalePx / 2).toFixed(1)} y={-7} textAnchor="middle">
              {scaleKm} km
            </text>
          </g>
        </svg>
      </div>
    </div>
  )
}
