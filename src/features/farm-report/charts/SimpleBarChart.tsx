import React from 'react'

/** Hand-rolled horizontal SVG bar chart — used for crop-score comparison and pest-risk levels. See `GroupedBarChart.tsx` for why this isn't a charting library. */

export interface SimpleBar {
  label: string
  value: number
  color: string
  sublabel?: string
}

interface SimpleBarChartProps {
  title: string
  bars: SimpleBar[]
  maxValue?: number
  formatValue?: (value: number) => string
}

const WIDTH = 640
const ROW_HEIGHT = 34
const LABEL_WIDTH = 170

const SimpleBarChart: React.FC<SimpleBarChartProps> = ({ title, bars, maxValue, formatValue }) => {
  const format = formatValue ?? ((v: number) => String(Math.round(v)))
  const max = maxValue ?? Math.max(1, ...bars.map((b) => b.value))
  const height = bars.length * ROW_HEIGHT + 16
  const plotWidth = WIDTH - LABEL_WIDTH - 60

  return (
    <div style={{ width: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F', marginBottom: 8, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        {bars.map((bar, i) => {
          const y = i * ROW_HEIGHT + 6
          const barWidth = Math.max(0, (bar.value / max) * plotWidth)
          return (
            <g key={bar.label}>
              <text x={LABEL_WIDTH - 12} y={y + 16} textAnchor="end" fontSize={12} fill="#1F1F1F" fontWeight={600}>
                {bar.label}
              </text>
              <rect x={LABEL_WIDTH} y={y} width={plotWidth} height={22} fill="#F0F0F0" rx={4} />
              <rect x={LABEL_WIDTH} y={y} width={barWidth} height={22} fill={bar.color} rx={4} />
              <text x={LABEL_WIDTH + barWidth + 10} y={y + 16} fontSize={12} fontWeight={700} fill="#1F1F1F">
                {format(bar.value)}
                {bar.sublabel ? ` ${bar.sublabel}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default SimpleBarChart
