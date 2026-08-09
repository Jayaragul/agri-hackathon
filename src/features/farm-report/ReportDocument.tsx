import React from 'react'
import type { FarmReportData } from '../../domain/models/reportModels'
import { parseIsoDate } from '../../engine/cropCalendarEngine'
import GroupedBarChart from './charts/GroupedBarChart'
import DonutChart from './charts/DonutChart'
import SimpleBarChart from './charts/SimpleBarChart'
import PhaseTimeline from './charts/PhaseTimeline'

/**
 * The Full Farm Report's actual document tree — rendered off-screen (see
 * `services/report/pdfExport.ts` and the generator hook that mounts this) and captured
 * section-by-section into a paginated PDF. Every figure here is read straight off `FarmReportData`
 * (see `engine/reportEngine.ts`) — this component only formats and charts, it never computes.
 *
 * Deliberately styled with literal hex colors, not `var(--…)` CSS custom properties: a PDF is a
 * fixed printed artifact independent of the live app's light/dark theme, and it keeps this
 * component's rendering fully self-contained for `html2canvas` regardless of where it's mounted.
 */

const PAGE_WIDTH = 794 // A4 at 96dpi
const INK = '#1F1F1F'
const MUTED = '#757575'
const BORDER = '#E5E5E5'
const BLUE = '#4285F4'
const RED = '#EA4335'
const YELLOW = '#FBBC05'
const GREEN = '#34A853'

const sectionStyle: React.CSSProperties = {
  width: PAGE_WIDTH,
  background: '#FFFFFF',
  padding: '40px 48px',
  boxSizing: 'border-box',
  color: INK,
  fontFamily: "'Segoe UI', Roboto, Arial, sans-serif",
}

const h2Style: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  margin: '0 0 20px',
  paddingBottom: 12,
  borderBottom: `2px solid ${BORDER}`,
  color: INK,
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: MUTED,
  textTransform: 'uppercase',
  fontFamily: 'monospace',
  letterSpacing: 0.5,
  marginBottom: 6,
  display: 'block',
}

const cardStyle: React.CSSProperties = {
  background: '#FAFAFA',
  border: `1px solid ${BORDER}`,
  borderRadius: 10,
  padding: '16px 18px',
}

function formatCurrency(v: number): string {
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

function formatDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const DECISION_LABEL: Record<string, string> = {
  recommended: 'Recommended',
  'recommended-with-corrections': 'Recommended (with corrections)',
  'high-risk': 'High risk',
  'not-currently-feasible': 'Not currently feasible',
}

const ReportDocument: React.FC<{ data: FarmReportData }> = ({ data }) => {
  const { profile, crop, recommendation, allRecommendations, gapAnalysis, financials, pestRisks, calendarPlan, weeklyPlan, marketDemand, farmerName } = data

  const cost = financials.expected.costBreakdown

  return (
    <div style={{ width: PAGE_WIDTH }}>
      {/* --- Cover --- */}
      <section className="report-section" style={{ ...sectionStyle, minHeight: 500, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 14, letterSpacing: 4, color: MUTED, textTransform: 'uppercase', marginBottom: 24, fontFamily: 'monospace' }}>Thulir · Full Farm Report</div>
        <div style={{ fontSize: 48 }}>{crop.emoji}</div>
        <h1 style={{ fontSize: 38, margin: '16px 0 8px' }}>{crop.name} Cultivation Plan</h1>
        <div style={{ fontSize: 16, color: MUTED, marginBottom: 40 }}>
          {farmerName ? `${farmerName} · ` : ''}
          {profile.acres} Acres · {profile.region} · {profile.soilType}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
          <div style={cardStyle}>
            <span style={labelStyle}>Sowing</span>
            <strong style={{ fontSize: 16 }}>{formatDate(calendarPlan.sowingDateIso)}</strong>
          </div>
          <div style={cardStyle}>
            <span style={labelStyle}>Harvest window</span>
            <strong style={{ fontSize: 16 }}>{formatDate(calendarPlan.harvestDateIso)}</strong>
          </div>
          <div style={cardStyle}>
            <span style={labelStyle}>Decision</span>
            <strong style={{ fontSize: 16 }}>{DECISION_LABEL[recommendation.decisionStatus] ?? recommendation.decisionStatus}</strong>
          </div>
        </div>
        <div style={{ marginTop: 48, fontSize: 12, color: MUTED }}>
          Generated {new Date(data.generatedAtIso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      </section>

      {/* --- Soil Health --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>1 · Soil Health Snapshot</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
          {[
            { label: 'Soil pH', value: profile.ph.toFixed(1), sub: `Ideal ${crop.idealPhMin}–${crop.idealPhMax}` },
            { label: 'Nitrogen', value: `${profile.nitrogenKgPerAcre} kg/ac`, sub: `Needs ${crop.nitrogenRequired}` },
            { label: 'Phosphorus', value: `${profile.phosphorusKgPerAcre} kg/ac`, sub: `Needs ${crop.phosphorusRequired}` },
            { label: 'Potassium', value: `${profile.potassiumKgPerAcre} kg/ac`, sub: `Needs ${crop.potassiumRequired}` },
          ].map((s) => (
            <div key={s.label} style={cardStyle}>
              <span style={labelStyle}>{s.label}</span>
              <strong style={{ fontSize: 18, display: 'block' }}>{s.value}</strong>
              <span style={{ fontSize: 11, color: MUTED }}>{s.sub}</span>
            </div>
          ))}
        </div>
        <GroupedBarChart
          title="Nutrients — available vs. required (kg/acre)"
          groups={[
            { label: 'Nitrogen', bars: [{ label: 'Available', value: profile.nitrogenKgPerAcre, color: BLUE }, { label: 'Required', value: crop.nitrogenRequired, color: BORDER }] },
            { label: 'Phosphorus', bars: [{ label: 'Available', value: profile.phosphorusKgPerAcre, color: BLUE }, { label: 'Required', value: crop.phosphorusRequired, color: BORDER }] },
            { label: 'Potassium', bars: [{ label: 'Available', value: profile.potassiumKgPerAcre, color: BLUE }, { label: 'Required', value: crop.potassiumRequired, color: BORDER }] },
          ]}
        />
      </section>

      {/* --- Crop Recommendation --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>2 · Crop Recommendation</h2>
        <SimpleBarChart
          title="Suitability score by crop (out of 100)"
          maxValue={100}
          bars={allRecommendations
            .slice()
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((r) => ({
              label: `${r.crop.emoji} ${r.crop.name}`,
              value: Math.round(r.score),
              color: r.crop.id === crop.id ? GREEN : BLUE,
            }))}
        />
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <span style={labelStyle}>Why {crop.name}</span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {recommendation.positiveReasons.length > 0 ? recommendation.positiveReasons.map((r, i) => <li key={i}>{r}</li>) : <li>No standout strengths recorded.</li>}
            </ul>
          </div>
          <div>
            <span style={labelStyle}>Risks to manage</span>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
              {recommendation.riskReasons.length > 0 ? recommendation.riskReasons.map((r, i) => <li key={i}>{r}</li>) : <li>No material risks flagged.</li>}
            </ul>
          </div>
        </div>
      </section>

      {/* --- Soil Correction Plan --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>3 · Soil Correction Plan</h2>
        {gapAnalysis.gaps.length === 0 ? (
          <p style={{ fontSize: 14, color: MUTED }}>Soil conditions are already suitable — no pre-farming corrections required.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: `2px solid ${BORDER}` }}>
                <th style={{ padding: '8px 6px' }}>Gap</th>
                <th style={{ padding: '8px 6px' }}>Severity</th>
                <th style={{ padding: '8px 6px' }}>Action</th>
                <th style={{ padding: '8px 6px' }}>Lead time</th>
                <th style={{ padding: '8px 6px' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {gapAnalysis.gaps.map((g, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                  <td style={{ padding: '8px 6px', fontWeight: 600 }}>{g.gapLabel}</td>
                  <td style={{ padding: '8px 6px', color: g.severity === 'critical' ? RED : g.severity === 'warning' ? YELLOW : MUTED }}>{g.severity}</td>
                  <td style={{ padding: '8px 6px' }}>{g.correction?.biologicalFix ?? '—'}</td>
                  <td style={{ padding: '8px 6px' }}>{g.correction?.minimumDaysBeforeSowing ?? 0} days before sowing</td>
                  <td style={{ padding: '8px 6px' }}>{g.correction ? formatCurrency(g.correction.estimatedCostPerAcre * profile.acres) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <strong>Total correction cost:</strong> {formatCurrency(gapAnalysis.totalCorrectionCost)} · <strong>Wait before sowing:</strong> {gapAnalysis.maxDaysBeforeSowing} days
        </div>
      </section>

      {/* --- Financial Forecast --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>4 · Financial Forecast</h2>
        <GroupedBarChart
          title="Net profit by scenario (₹)"
          formatValue={(v) => `₹${Math.round(v / 1000)}k`}
          groups={[
            { label: 'Conservative', bars: [{ label: 'Net profit', value: financials.conservative.netProfit, color: financials.conservative.isLoss ? RED : GREEN }] },
            { label: 'Expected', bars: [{ label: 'Net profit', value: financials.expected.netProfit, color: financials.expected.isLoss ? RED : GREEN }] },
            { label: 'Optimistic', bars: [{ label: 'Net profit', value: financials.optimistic.netProfit, color: financials.optimistic.isLoss ? RED : GREEN }] },
          ]}
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, margin: '24px 0' }}>
          {[
            { label: 'Total investment', value: formatCurrency(financials.expected.totalInvestment) },
            { label: 'Expected revenue', value: formatCurrency(financials.expected.grossRevenue) },
            { label: 'ROI', value: `${financials.expected.roi.toFixed(1)}%` },
            { label: 'Break-even price', value: `₹${financials.expected.breakEvenPricePerKg.toFixed(1)}/kg` },
          ].map((s) => (
            <div key={s.label} style={cardStyle}>
              <span style={labelStyle}>{s.label}</span>
              <strong style={{ fontSize: 16 }}>{s.value}</strong>
            </div>
          ))}
        </div>
        <DonutChart
          title="Investment breakdown (expected scenario)"
          centerLabel="Total"
          centerValue={formatCurrency(financials.expected.totalInvestment)}
          slices={[
            { label: 'Seed', value: cost.seed, color: BLUE },
            { label: 'Fertilizer', value: cost.fertilizer, color: GREEN },
            { label: 'Pesticide', value: cost.pesticide, color: RED },
            { label: 'Irrigation', value: cost.irrigation, color: YELLOW },
            { label: 'Labor', value: cost.labor, color: '#8E44AD' },
            { label: 'Machinery', value: cost.machinery, color: '#16A085' },
            { label: 'Post-harvest', value: cost.postHarvest, color: '#D35400' },
            { label: 'Mandi charges', value: cost.mandiCharges, color: '#2C3E50' },
            { label: 'Soil correction', value: cost.soilCorrection, color: '#7F8C8D' },
          ]}
        />
      </section>

      {/* --- Pest Risk --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>5 · Pest Risk Forecast</h2>
        {pestRisks.length === 0 ? (
          <p style={{ fontSize: 14, color: MUTED }}>No major pest warnings dataset for this crop. Maintain good field sanitation.</p>
        ) : (
          <>
            <SimpleBarChart
              title="Risk level by pest"
              maxValue={3}
              formatValue={(v) => (v >= 3 ? 'High' : v >= 2 ? 'Medium' : 'Low')}
              bars={pestRisks
                .slice()
                .sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.riskLevel] - { high: 3, medium: 2, low: 1 }[a.riskLevel]))
                .map((p) => ({
                  label: `${p.pestEmoji} ${p.pestName}`,
                  value: { high: 3, medium: 2, low: 1 }[p.riskLevel],
                  color: p.riskLevel === 'high' ? RED : p.riskLevel === 'medium' ? YELLOW : GREEN,
                }))}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
              {pestRisks.map((p) => (
                <div key={p.id} style={cardStyle}>
                  <strong style={{ fontSize: 13 }}>{p.pestEmoji} {p.pestName}</strong>
                  <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>Biological control: {p.biologicalControl}</div>
                  <div style={{ fontSize: 12, color: MUTED }}>Act at: {p.economicThreshold}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* --- Cultivation Timeline --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>6 · Cultivation Timeline</h2>
        <PhaseTimeline title={`${crop.name} growth phases — ${formatDate(calendarPlan.sowingDateIso)} to ${formatDate(calendarPlan.harvestDateIso)}`} days={calendarPlan.days} />
      </section>

      {/* --- Weekly Plan & Goals --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>7 · Weekly Plan &amp; Goals</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {weeklyPlan.map((w) => (
            <div key={w.weekIndex} style={{ ...cardStyle, breakInside: 'avoid' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>
                  Week {w.weekIndex + 1} · {formatDate(w.startDateIso)} – {formatDate(w.endDateIso)}
                </strong>
                <span style={{ fontSize: 11, color: MUTED }}>{w.phases.join(' → ')}</span>
              </div>
              <div style={{ fontSize: 12 }}>
                <strong style={{ color: MUTED }}>Goals: </strong>
                {w.goals.length > 0 ? w.goals.join(' · ') : 'Continue routine cultivation activity.'}
              </div>
              {w.watchOuts.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  <strong style={{ color: RED }}>Watch: </strong>
                  {w.watchOuts.join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* --- Full Daily Plan --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>8 · Full Daily Plan</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: `2px solid ${BORDER}` }}>
              <th style={{ padding: '5px 6px', width: 90 }}>Date</th>
              <th style={{ padding: '5px 6px', width: 120 }}>Phase</th>
              <th style={{ padding: '5px 6px' }}>Tasks</th>
              <th style={{ padding: '5px 6px', width: 140 }}>Watch for</th>
            </tr>
          </thead>
          <tbody>
            {calendarPlan.days.map((d) => (
              <tr key={d.dateIso} style={{ borderBottom: `1px solid ${BORDER}`, background: d.isMilestone ? '#FFF9E6' : 'transparent' }}>
                <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{formatDate(d.dateIso)}</td>
                <td style={{ padding: '4px 6px' }}>{d.phaseLabel}</td>
                <td style={{ padding: '4px 6px' }}>{d.tasks.length > 0 ? d.tasks.join('; ') : '—'}</td>
                <td style={{ padding: '4px 6px', color: RED }}>{d.risks.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* --- Market Insight --- */}
      <section className="report-section" style={sectionStyle}>
        <h2 style={h2Style}>9 · Market Insight</h2>
        {marketDemand && marketDemand.demandTier !== 'no-data' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div style={cardStyle}>
              <span style={labelStyle}>Demand (last {marketDemand.windowDays} days)</span>
              <strong style={{ fontSize: 18, textTransform: 'capitalize' }}>{marketDemand.demandTier}</strong>
              <span style={{ fontSize: 11, color: MUTED }}>{marketDemand.requestCount} buyer requests</span>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Quantity requested</span>
              <strong style={{ fontSize: 18 }}>
                {marketDemand.totalQuantityRequested} {marketDemand.unit ?? ''}
              </strong>
            </div>
            <div style={cardStyle}>
              <span style={labelStyle}>Suggested price</span>
              <strong style={{ fontSize: 18 }}>{marketDemand.suggestedPricePerUnit ? `₹${marketDemand.suggestedPricePerUnit}/unit` : 'Not yet quoted'}</strong>
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: MUTED }}>
            No live FarmConnect marketplace demand recorded for {crop.name} yet. Check back closer to harvest — this section updates automatically once buyers post requests.
          </p>
        )}
      </section>

      {/* --- Disclaimer --- */}
      <section className="report-section" style={{ ...sectionStyle, paddingTop: 24, paddingBottom: 48, textAlign: 'center' }}>
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 24, fontSize: 11, color: MUTED, lineHeight: 1.7 }}>
          <strong>Disclaimer:</strong> This report is generated by Thulir AI Decision Support. Recommendations, cost estimates, yield
          projections, and pest forecasts are based on regional averages and predictive models, not a site inspection. Always consult a
          certified agronomist or local KVK extension officer before making final financial or chemical-input decisions.
        </div>
      </section>
    </div>
  )
}

export default ReportDocument
