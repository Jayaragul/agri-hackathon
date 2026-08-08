import React, { useEffect, useState } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { analyzeSoilGaps } from '../../engine/soilGapAnalysis'
import { SoilGapAnalysisResult, RecommendationResult } from '../../domain/models/models'
import { sampleCorrections } from '../../data/sample/corrections'
import { AlertTriangle, CheckCircle, ArrowRight } from 'lucide-react'

const SoilCorrections: React.FC = () => {
  const { profile, selectedCrop, setStage, recommendations } = useFarmStore()
  const [analysis, setAnalysis] = useState<SoilGapAnalysisResult | null>(null)

  useEffect(() => {
    if (profile && selectedCrop) {
      // Find the specific recommendation result for this crop
      const rec = recommendations.find(r => r.crop.id === selectedCrop.id)
      if (rec) {
        setAnalysis(analyzeSoilGaps(profile, selectedCrop, sampleCorrections, rec))
      }
    }
  }, [profile, selectedCrop, recommendations])

  if (!profile || !selectedCrop || !analysis) return <div>Loading analysis...</div>

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Pre-Farming Plan</span>
      </div>

      <h2 style={{ marginBottom: '24px' }}>
        Soil <span className="gradient-text gradient-underline">Action Plan</span>
      </h2>
      <p style={{ marginBottom: '32px', color: 'var(--muted-foreground)', fontSize: '18px' }}>
        Fixing your soil *before* sowing {selectedCrop.name} prevents losses and maximizes yield.
      </p>

      {analysis.gaps.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '64px 20px', border: '1px dashed var(--color-green-700)' }}>
          <CheckCircle size={64} color="var(--color-green-700)" style={{ margin: '0 auto 24px' }} />
          <h3 style={{ fontSize: '24px', marginBottom: '8px' }}>Your soil is ready!</h3>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '16px' }}>
            No major corrections needed for {selectedCrop.name}. You can proceed directly to financial planning.
          </p>
        </div>
      ) : (
        <>
          <div className="grid-2" style={{ marginBottom: '32px' }}>
            <div className="card" style={{ marginBottom: 0, padding: '24px' }}>
              <div style={{ fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Total Fix Cost</div>
              <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--foreground)' }}>
                ₹{analysis.totalCorrectionCost.toLocaleString()}
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>for {profile.acres} acres</div>
            </div>
            <div className="card" style={{ marginBottom: 0, padding: '24px' }}>
              <div style={{ fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Required Wait Time</div>
              <div style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-amber-600)' }}>
                {analysis.maxDaysBeforeSowing} Days
              </div>
              <div style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>before sowing</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '40px' }}>
            {analysis.gaps.map((gap, i) => {
              if (!gap.correction) return null;
              
              const isCritical = gap.severity === 'critical';
              const themeColor = isCritical ? 'var(--color-red-600)' : 'var(--color-amber-600)';
              
              return (
                <div key={i} className="card" style={{ 
                  borderLeft: `4px solid ${themeColor}`,
                  marginBottom: 0
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <div style={{ background: isCritical ? 'var(--color-red-50)' : 'var(--color-amber-50)', padding: '12px', borderRadius: '50%' }}>
                      <AlertTriangle color={themeColor} size={24} />
                    </div>
                    <h3 style={{ fontSize: '20px', margin: 0, color: 'var(--foreground)' }}>{gap.gapLabel}</h3>
                    {isCritical && <span className="badge badge-red" style={{ marginLeft: 'auto' }}>Critical</span>}
                  </div>
                  
                  <p style={{ fontSize: '16px', color: 'var(--muted-foreground)', marginBottom: '24px' }}>
                    {gap.cropContext}
                  </p>

                  <div style={{ background: 'var(--color-green-50)', padding: '20px', borderRadius: '12px', marginBottom: '16px' }}>
                    <strong style={{ display: 'block', fontSize: '13px', color: 'var(--color-green-700)', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>NATURAL / BIOLOGICAL FIX (RECOMMENDED)</strong>
                    <div style={{ fontSize: '16px', color: 'var(--foreground)' }}>{gap.correction.biologicalFix}</div>
                  </div>

                  {gap.correction.chemicalFix && (
                    <div style={{ background: 'var(--muted)', padding: '20px', borderRadius: '12px', marginBottom: '16px' }}>
                      <strong style={{ display: 'block', fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '8px', fontFamily: 'var(--font-mono)' }}>CHEMICAL ALTERNATIVE</strong>
                      <div style={{ fontSize: '16px', color: 'var(--foreground)' }}>{gap.correction.chemicalFix}</div>
                    </div>
                  )}

                  {gap.correction.safetyNote && (
                    <div className="alert alert-warning" style={{ margin: 0 }}>
                      <div className="alert-desc"><strong>Note:</strong> {gap.correction.safetyNote}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <button className="btn btn-primary" onClick={() => setStage('financials')} style={{ width: 'auto' }}>
        View Profitability Forecast <ArrowRight size={18} />
      </button>
    </div>
  )
}

export default SoilCorrections
