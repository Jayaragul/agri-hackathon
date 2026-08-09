import React, { useMemo } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { analyzeSoilGaps } from '../../engine/soilGapAnalysis'
import { generateFinancialScenarios } from '../../engine/financialEngine'
import { sampleCorrections } from '../../data/sample/corrections'
import { Printer, Calendar, IndianRupee, Sprout, AlertTriangle, FileDown, Loader2 } from 'lucide-react'
import { useFarmReportGenerator } from '../farm-report/useFarmReportGenerator'

const PrintableActionPlan: React.FC = () => {
  const { profile, selectedCrop, reset, recommendations, setStage } = useFarmStore()
  const { generate: generateFullReport, generating: generatingFullReport, error: fullReportError, canGenerate: canGenerateFullReport } = useFarmReportGenerator()

  const { analysis, financials } = useMemo(() => {
    if (!profile || !selectedCrop) return { analysis: null, financials: null }
    const rec = recommendations.find(r => r.crop.id === selectedCrop.id)
    if (!rec) return { analysis: null, financials: null }

    const gapAnalysis = analyzeSoilGaps(profile, selectedCrop, sampleCorrections, rec)
    const fin = generateFinancialScenarios(profile, selectedCrop, gapAnalysis)
    return { analysis: gapAnalysis, financials: fin.expected }
  }, [profile, selectedCrop, recommendations])

  if (!profile || !selectedCrop || !analysis || !financials) return <div>Generating plan...</div>

  const handlePrint = () => {
    window.print()
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      
      <div className="section-badge print-hide">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Success Strategy</span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }} className="print-hide">
        <h2 style={{ margin: 0, lineHeight: 1.2 }}>
          Your <span className="gradient-text gradient-underline">Action Plan</span>
        </h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setStage('calendar')}>
            <Calendar size={18} style={{ marginRight: '8px' }} /> Cultivation Calendar
          </button>
          <button className="btn btn-primary" onClick={generateFullReport} disabled={!canGenerateFullReport || generatingFullReport}>
            {generatingFullReport ? (
              <Loader2 size={18} style={{ marginRight: '8px' }} className="spin" />
            ) : (
              <FileDown size={18} style={{ marginRight: '8px' }} />
            )}
            {generatingFullReport ? 'Building report…' : 'Download Full Report'}
          </button>
          <button className="btn btn-outline" onClick={handlePrint}>
            <Printer size={18} style={{ marginRight: '8px' }} /> Print PDF
          </button>
          <button className="btn btn-secondary" onClick={reset}>
            New Farm
          </button>
        </div>
      </div>

      {fullReportError && (
        <div className="alert alert-info print-hide" style={{ marginBottom: '24px', borderLeftColor: 'var(--brand-red)' }}>
          <AlertTriangle size={20} style={{ flexShrink: 0, color: 'var(--brand-red)' }} />
          <div className="alert-desc">{fullReportError}</div>
        </div>
      )}

      {/* --- PRINTABLE AREA START --- */}
      <div className="printable-plan card" style={{ padding: '48px 40px' }}>
        
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid var(--border)', paddingBottom: '32px', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '40px', color: 'var(--foreground)', marginBottom: '16px' }}>
            {selectedCrop.emoji} {selectedCrop.name} Cultivation Plan
          </h1>
          <div style={{ fontSize: '18px', color: 'var(--muted-foreground)', display: 'flex', justifyContent: 'center', gap: '24px', fontFamily: 'var(--font-mono)' }}>
            <span>{profile.acres} Acres</span>
            <span>•</span>
            <span>{profile.region}</span>
            <span>•</span>
            <span>{new Date(2024, profile.currentMonth - 1).toLocaleString('default', { month: 'long' })} Sowing</span>
          </div>
        </div>

        {/* Section 1: Pre-Farming Preparation */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '24px', color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
            <Calendar size={24} color="var(--accent)" /> Phase 1: Soil Preparation (Wait {analysis.maxDaysBeforeSowing} Days)
          </h2>
          
          {analysis.gaps.length === 0 ? (
            <p style={{ fontSize: '16px', color: 'var(--muted-foreground)' }}>Soil conditions are optimal. No pre-farming corrections required.</p>
          ) : (
            <ul style={{ paddingLeft: '0', listStyleType: 'none', margin: 0 }}>
              {analysis.gaps.map((gap, i) => (
                <li key={i} style={{ marginBottom: '24px', background: 'var(--muted)', padding: '20px', borderRadius: '12px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--foreground)', marginBottom: '12px' }}>
                    <AlertTriangle size={20} color={gap.severity === 'critical' ? 'var(--color-red-600)' : 'var(--color-amber-600)'} /> 
                    {gap.gapLabel}
                  </div>
                  <div style={{ fontSize: '16px', color: 'var(--foreground)', paddingLeft: '32px' }}>
                    <strong>Action:</strong> {gap.correction?.biologicalFix}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Section 2: Cultivation Guidelines */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{ fontSize: '24px', color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
            <Sprout size={24} color="var(--accent)" /> Phase 2: Cultivation Guidelines
          </h2>
          <div className="grid-2">
            <div style={{ background: 'var(--muted)', padding: '20px', borderRadius: '12px' }}>
              <strong style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Expected Duration</strong>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)' }}>{selectedCrop.durationDays} Days</div>
            </div>
            <div style={{ background: 'var(--muted)', padding: '20px', borderRadius: '12px' }}>
              <strong style={{ display: 'block', marginBottom: '8px', fontSize: '13px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Compatible Soils</strong>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--foreground)' }}>{selectedCrop.compatibleSoilTypes.join(', ')}</div>
            </div>
            <div style={{ gridColumn: '1 / -1', background: 'var(--muted)', padding: '24px', borderRadius: '12px' }}>
              <strong style={{ display: 'block', marginBottom: '12px', fontSize: '13px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Key Recommendation</strong>
              <div style={{ fontSize: '16px', lineHeight: 1.7, color: 'var(--foreground)' }}>{selectedCrop.description}</div>
            </div>
          </div>
        </div>

        {/* Section 3: Financial Summary */}
        <div style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '24px', color: 'var(--foreground)', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)', paddingBottom: '12px', marginBottom: '24px' }}>
            <IndianRupee size={24} color="var(--accent)" /> Phase 3: Financial Requirements
          </h2>
          
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
            <div style={{ flex: 1, minWidth: '240px', background: 'var(--muted)', padding: '24px', borderRadius: '12px' }}>
              <div style={{ fontSize: '13px', color: 'var(--muted-foreground)', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>Total Investment</div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: 'var(--foreground)' }}>₹{Math.round(financials.totalInvestment).toLocaleString()}</div>
            </div>
            
            <div style={{ flex: 1, minWidth: '240px', background: financials.isLoss ? 'var(--color-red-50)' : 'var(--color-green-50)', padding: '24px', borderRadius: '12px' }}>
              <div style={{ fontSize: '13px', color: financials.isLoss ? 'var(--color-red-700)' : 'var(--color-green-800)', textTransform: 'uppercase', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>Expected Net Profit</div>
              <div style={{ fontSize: '32px', fontWeight: 700, color: financials.isLoss ? 'var(--color-red-700)' : 'var(--color-green-700)' }}>
                ₹{Math.round(financials.netProfit).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Disclaimer */}
        <div style={{ marginTop: '64px', paddingTop: '32px', borderTop: '1px solid var(--border)', fontSize: '13px', color: 'var(--muted-foreground)', textAlign: 'center', lineHeight: 1.6 }}>
          <strong>Disclaimer:</strong> This plan is generated by Thulir AI Decision Support.
          Cost estimates, yield projections, and pest controls are based on regional averages and predictive models. 
          Always consult a local agricultural extension officer before making final financial commitments.
        </div>
      </div>
      {/* --- PRINTABLE AREA END --- */}

    </div>
  )
}

export default PrintableActionPlan
