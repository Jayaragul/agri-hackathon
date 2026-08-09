import React from 'react'

/** Hand-rolled SVG donut chart — used for the investment cost breakdown. See `GroupedBarChart.tsx` for why this isn't a charting library. */

export interface DonutSlice {
  label: string
  value: number
  color: string
}

interface DonutChartProps {
  title: string
  slices: DonutSlice[]
  centerLabel?: string
  centerValue?: string
}

const SIZE = 220
const STROKE = 34
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const DonutChart: React.FC<DonutChartProps> = ({ title, slices, centerLabel, centerValue }) => {
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  let cumulative = 0

  return (
    <div style={{ width: '100%', display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#EFEFEF" strokeWidth={STROKE} />
          {total > 0 &&
            slices
              .filter((s) => s.value > 0)
              .map((slice) => {
                const fraction = slice.value / total
                const dash = fraction * CIRCUMFERENCE
                const gap = CIRCUMFERENCE - dash
                const offset = -cumulative * CIRCUMFERENCE
                cumulative += fraction
                return (
                  <circle
                    key={slice.label}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={slice.color}
                    strokeWidth={STROKE}
                    strokeDasharray={`${dash} ${gap}`}
                    strokeDashoffset={offset}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                  />
                )
              })}
        </svg>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 12, color: '#757575', fontFamily: 'monospace', textTransform: 'uppercase' }}>{centerLabel}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1F1F1F' }}>{centerValue}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1F', marginBottom: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slices
            .filter((s) => s.value > 0)
            .sort((a, b) => b.value - a.value)
            .map((slice) => (
              <div key={slice.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: slice.color, display: 'inline-block', flexShrink: 0 }} />
                <span style={{ color: '#1F1F1F', flex: 1 }}>{slice.label}</span>
                <span style={{ color: '#4B4B4B', fontWeight: 600 }}>
                  ₹{Math.round(slice.value).toLocaleString()} ({total > 0 ? Math.round((slice.value / total) * 100) : 0}%)
                </span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}

export default DonutChart
