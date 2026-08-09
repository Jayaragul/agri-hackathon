import React from 'react'
import type { CalendarDay, CropCalendarPhase } from '../../../engine/cropCalendarEngine'
import { PHASE_LABELS } from '../../../engine/cropCalendarEngine'

/**
 * Hand-rolled horizontal Gantt-style SVG timeline of the cultivation calendar's phases —
 * soil prep through harvest window, proportional to each phase's day-span. See
 * `GroupedBarChart.tsx` for why this isn't a charting library.
 */

const PHASE_COLOR: Record<CropCalendarPhase, string> = {
  'soil-prep': '#757575',
  germination: '#FBBC05',
  vegetative: '#34A853',
  flowering: '#4285F4',
  maturation: '#F9A825',
  'harvest-window': '#EA4335',
}

interface PhaseTimelineProps {
  title: string
  days: CalendarDay[]
}

const WIDTH = 640
const BAR_HEIGHT = 48

const PhaseTimeline: React.FC<PhaseTimelineProps> = ({ title, days }) => {
  if (days.length === 0) return null
  const sorted = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  const totalDays = sorted.length

  const segments: Array<{ phase: CropCalendarPhase; count: number; startDateIso: string; endDateIso: string }> = []
  for (const day of sorted) {
    const last = segments[segments.length - 1]
    if (last && last.phase === day.phase) {
      last.count += 1
      last.endDateIso = day.dateIso
    } else {
      segments.push({ phase: day.phase, count: 1, startDateIso: day.dateIso, endDateIso: day.dateIso })
    }
  }

  const milestones = sorted.filter((d) => d.isMilestone)
  const height = BAR_HEIGHT + 70

  let cursor = 0

  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F', marginBottom: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {segments.map((seg) => {
          const x = (cursor / totalDays) * WIDTH
          const w = (seg.count / totalDays) * WIDTH
          cursor += seg.count
          return (
            <g key={`${seg.phase}-${seg.startDateIso}`}>
              <rect x={x} y={16} width={Math.max(0, w - 1)} height={BAR_HEIGHT} fill={PHASE_COLOR[seg.phase]} />
              {w > 55 && (
                <text
                  x={x + w / 2}
                  y={16 + BAR_HEIGHT / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill={seg.phase === 'germination' || seg.phase === 'maturation' ? '#1F1F1F' : '#FFFFFF'}
                >
                  {PHASE_LABELS[seg.phase]}
                </text>
              )}
            </g>
          )
        })}

        {milestones.map((m) => {
          const idx = sorted.findIndex((d) => d.dateIso === m.dateIso)
          const x = (idx / totalDays) * WIDTH
          return (
            <g key={m.dateIso}>
              <line x1={x} y1={10} x2={x} y2={16 + BAR_HEIGHT + 6} stroke="#1F1F1F" strokeWidth={1.5} />
              <circle cx={x} cy={10} r={3} fill="#1F1F1F" />
            </g>
          )
        })}

        <text x={0} y={16 + BAR_HEIGHT + 26} fontSize={12} fill="#4B4B4B">
          {sorted[0].dateIso}
        </text>
        <text x={WIDTH} y={16 + BAR_HEIGHT + 26} fontSize={12} fill="#4B4B4B" textAnchor="end">
          {sorted[sorted.length - 1].dateIso}
        </text>
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
        {(Object.keys(PHASE_COLOR) as CropCalendarPhase[]).map((phase) => (
          <span key={phase} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#4B4B4B' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: PHASE_COLOR[phase], display: 'inline-block' }} />
            {PHASE_LABELS[phase]}
          </span>
        ))}
      </div>
    </div>
  )
}

export default PhaseTimeline
