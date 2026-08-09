import React from 'react'

/**
 * Hand-rolled SVG grouped bar chart — used for "actual vs required" nutrients and
 * conservative/expected/optimistic financial scenarios. Deliberately not a charting library:
 * this document is captured to a static image by `services/report/pdfExport.ts`, and a fixed,
 * dependency-free SVG with an explicit pixel viewBox renders identically whether it's on-screen
 * or off-screen mid-capture — no ResizeObserver/container-measurement race to worry about.
 */

export interface GroupedBarSeries {
  label: string
  value: number
  color: string
}

export interface GroupedBarGroup {
  label: string
  bars: GroupedBarSeries[]
}

interface GroupedBarChartProps {
  title: string
  groups: GroupedBarGroup[]
  unit?: string
  height?: number
  formatValue?: (value: number) => string
}

const WIDTH = 640

const GroupedBarChart: React.FC<GroupedBarChartProps> = ({ title, groups, unit, height = 260, formatValue }) => {
  const format = formatValue ?? ((v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1)))
  const maxValue = Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => b.value)))
  const marginLeft = 8
  const marginRight = 8
  const marginTop = 30
  const marginBottom = 40
  const plotWidth = WIDTH - marginLeft - marginRight
  const plotHeight = height - marginTop - marginBottom
  const groupGap = 24
  const groupWidth = groups.length > 0 ? (plotWidth - groupGap * (groups.length - 1)) / groups.length : plotWidth
  const barGap = 6

  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F', marginBottom: 6, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {/* baseline */}
        <line x1={marginLeft} y1={height - marginBottom} x2={WIDTH - marginRight} y2={height - marginBottom} stroke="#E5E5E5" strokeWidth={1} />
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={marginLeft}
            y1={height - marginBottom - plotHeight * f}
            x2={WIDTH - marginRight}
            y2={height - marginBottom - plotHeight * f}
            stroke="#F0F0F0"
            strokeWidth={1}
          />
        ))}

        {groups.map((group, gi) => {
          const groupX = marginLeft + gi * (groupWidth + groupGap)
          const barWidth = (groupWidth - barGap * (group.bars.length - 1)) / Math.max(1, group.bars.length)
          return (
            <g key={group.label}>
              {group.bars.map((bar, bi) => {
                const barHeight = Math.max(0, (bar.value / maxValue) * plotHeight)
                const barX = groupX + bi * (barWidth + barGap)
                const barY = height - marginBottom - barHeight
                return (
                  <g key={bar.label}>
                    <rect x={barX} y={barY} width={barWidth} height={barHeight} fill={bar.color} rx={3} />
                    <text x={barX + barWidth / 2} y={barY - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1F1F1F">
                      {format(bar.value)}
                    </text>
                  </g>
                )
              })}
              <text
                x={groupX + groupWidth / 2}
                y={height - marginBottom + 20}
                textAnchor="middle"
                fontSize={12}
                fill="#4B4B4B"
              >
                {group.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>
        {(groups[0]?.bars ?? []).map((bar) => (
          <span key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4B4B4B' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: bar.color, display: 'inline-block' }} />
            {bar.label}
            {unit ? ` (${unit})` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

export default GroupedBarChart
