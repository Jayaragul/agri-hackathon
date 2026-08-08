import React, { useMemo } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { spreadsheetPests } from '../../data/spreadsheetData'
import { ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react'

const PestDefense: React.FC = () => {
  const { selectedCrop, setStage } = useFarmStore()

  const pests = useMemo(() => {
    if (!selectedCrop) return []
    return spreadsheetPests.filter(p => p.cropId === selectedCrop.id).sort((a, b) => {
      const riskScore: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 }
      return riskScore[b.riskLevel] - riskScore[a.riskLevel]
    })
  }, [selectedCrop])

  if (!selectedCrop) return <div>Missing crop selection.</div>

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Pest Prevention</span>
      </div>

      <h2 style={{ marginBottom: '24px' }}>
        Proactive <span className="gradient-text gradient-underline">Defense</span>
      </h2>
      <p style={{ marginBottom: '40px', color: 'var(--muted-foreground)', fontSize: '18px' }}>
        Biological controls for {selectedCrop.name} to minimize chemical pesticide costs.
      </p>

      {pests.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '64px 20px', border: '1px dashed var(--color-green-700)' }}>
          <ShieldCheck size={64} color="var(--color-green-700)" style={{ margin: '0 auto 24px' }} />
          <h3 style={{ fontSize: '24px', marginBottom: '8px' }}>Low Pest Pressure Expected</h3>
          <p style={{ color: 'var(--muted-foreground)', fontSize: '16px' }}>
            No major pest warnings for this crop. Maintain good field sanitation.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', marginBottom: '48px' }}>
          {pests.map((pest) => (
            <div key={pest.id} className="card" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                <span style={{ fontSize: '32px' }}>{pest.pestEmoji}</span>
                <h3 style={{ fontSize: '24px', margin: 0, color: 'var(--foreground)' }}>{pest.pestName}</h3>
                <span className={`badge ${pest.riskLevel === 'high' ? 'badge-red' : pest.riskLevel === 'medium' ? 'badge-amber' : 'badge-green'}`} style={{ marginLeft: 'auto' }}>
                  {pest.riskLevel} Risk
                </span>
              </div>
              
              <div style={{ marginBottom: '24px' }}>
                <strong style={{ fontSize: '13px', color: 'var(--muted-foreground)', display: 'block', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Symptoms</strong>
                <p style={{ fontSize: '16px', color: 'var(--foreground)' }}>{pest.symptoms}</p>
              </div>

              <div style={{ background: 'var(--color-green-50)', padding: '20px', borderRadius: '12px', marginBottom: '16px', border: '1px solid var(--color-green-100)' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-green-800)', marginBottom: '12px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  <ShieldCheck size={16} /> Biological Control (Preventive)
                </strong>
                <div style={{ fontSize: '16px', color: 'var(--foreground)' }}>{pest.biologicalControl}</div>
              </div>

              <div style={{ padding: '20px', borderRadius: '12px', border: '1px dashed var(--color-red-200)', background: 'var(--color-red-50)' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-red-800)', marginBottom: '12px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                  <ShieldAlert size={16} /> Economic Threshold (Action Level)
                </strong>
                <div style={{ fontSize: '16px', color: 'var(--color-red-900)' }}>{pest.economicThreshold}</div>
                {pest.chemicalControl && (
                  <div style={{ fontSize: '14px', color: 'var(--foreground)', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--color-red-200)' }}>
                    <strong style={{ color: 'var(--color-red-800)' }}>Last Resort Chemical:</strong> {pest.chemicalControl}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-primary mobile-full-button" onClick={() => setStage('action-plan')} style={{ width: 'auto' }}>
        Generate Final Action Plan <ArrowRight size={18} />
      </button>
    </div>
  )
}

export default PestDefense
