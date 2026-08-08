import React, { useEffect, useState } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { rankCrops } from '../../engine/recommendationEngine'
import { analyzeSoilGaps } from '../../engine/soilGapAnalysis'
import { LocalTemplateExplanationProvider } from '../../services/explanation/LocalTemplateExplanationProvider'
import { RecommendationResult, SoilGapAnalysisResult } from '../../domain/models/models'
import { spreadsheetCrops, spreadsheetCorrections } from '../../data/spreadsheetData'
import { ChevronRight, ArrowRight, AlertTriangle, CheckCircle } from 'lucide-react'

const CropDecision: React.FC = () => {
  const { profile, setSelectedCrop, setRecommendations } = useFarmStore()
  const [results, setResults] = useState<{ result: RecommendationResult, gap: SoilGapAnalysisResult }[]>([])
  const [explanations, setExplanations] = useState<Record<string, string>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      const recs = rankCrops(profile, spreadsheetCrops)
      setRecommendations(recs)
      const combined = recs.map(r => ({
        result: r,
        gap: analyzeSoilGaps(profile, r.crop, spreadsheetCorrections, r)
      }))
      setResults(combined)
      
      const provider = new LocalTemplateExplanationProvider()
      
      const loadExps = async () => {
        const exps: Record<string, string> = {}
        for (const r of recs) {
          exps[r.crop.id] = await provider.explainRecommendation(r, profile)
        }
        setExplanations(exps)
      }
      loadExps()
    }
  }, [profile])

  if (!profile) return <div>Missing profile data.</div>

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Crop Matches</span>
      </div>

      <h2 style={{ marginBottom: '24px' }}>
        Recommended <span className="gradient-text gradient-underline">Crops</span>
      </h2>
      
      <p style={{ marginBottom: '32px', color: 'var(--muted-foreground)', fontSize: '18px' }}>
        Based on your soil profile ({profile.ph} pH, {profile.soilType}), here are the best matches.
      </p>

      {results.map(({ result, gap }, idx) => {
        const { crop, score, confidence, decisionStatus } = result
        const isExpanded = expandedId === crop.id
        const isTopMatch = idx === 0
        
        let scoreClass = 'high'
        if (score < 75) scoreClass = 'medium'
        if (score < 50) scoreClass = 'low'

        return (
          <div key={crop.id} className={isTopMatch ? 'card-featured' : ''} style={{ marginBottom: '20px' }}>
            <div className={isTopMatch ? 'card-featured-inner' : 'card'} style={{ padding: 0, overflow: 'hidden', border: isTopMatch ? 'none' : '' }}>
              <div
                className="crop-card-summary"
                style={{ 
                  padding: '24px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '24px',
                  cursor: 'pointer',
                  background: isExpanded ? 'var(--muted)' : 'transparent',
                  transition: 'background 0.2s'
                }}
                onClick={() => setExpandedId(isExpanded ? null : crop.id)}
              >
                <div className={`score-circle ${scoreClass}`}>
                  <span className="val">{score}</span>
                  <span className="lbl">Match</span>
                </div>
                
                <div className="crop-card-main" style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {crop.emoji} {crop.name}
                  </h3>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                    <span className={`badge ${confidence === 'high' ? 'badge-green' : 'badge-amber'}`}>
                      {confidence.toUpperCase()} Confidence
                    </span>
                    {gap.gaps.length > 0 && (
                      <span className="badge badge-amber">
                        Requires Soil Corrections
                      </span>
                    )}
                    {decisionStatus === 'not-currently-feasible' && (
                      <span className="badge badge-red">
                        <AlertTriangle size={12}/> High Risk
                      </span>
                    )}
                  </div>
                </div>
                
                <ChevronRight className="crop-card-chevron" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: 'var(--muted-foreground)' }} />
              </div>

              {isExpanded && (
                <div className="crop-card-details" style={{ padding: '24px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '15px', lineHeight: 1.7, color: 'var(--foreground)', marginBottom: '32px' }}>
                    {explanations[crop.id]?.split('\n').map((line, i) => {
                      if (line.startsWith('**')) return <strong key={i} style={{ display: 'block', marginTop: '16px', marginBottom: '8px', color: 'var(--primary)'}}>{line.replace(/\*\*/g, '')}</strong>;
                      if (line.startsWith('✅')) return <div key={i} style={{ display: 'flex', gap: '8px', color: 'var(--muted-foreground)'}}><CheckCircle size={16} color="var(--primary)" /> {line.substring(2)}</div>;
                      if (line.startsWith('⚠️')) return <div key={i} style={{ display: 'flex', gap: '8px', color: 'var(--muted-foreground)'}}><AlertTriangle size={16} color="orange" /> {line.substring(2)}</div>;
                      if (line.startsWith('❌')) return <div key={i} style={{ display: 'flex', gap: '8px', color: 'var(--muted-foreground)'}}><AlertTriangle size={16} color="red" /> {line.substring(2)}</div>;
                      return <div key={i} style={{ color: 'var(--muted-foreground)', marginLeft: '24px' }}>{line}</div>;
                    })}
                  </div>

                  {decisionStatus !== 'not-currently-feasible' && (
                    <div className="grid-2" style={{ marginBottom: '32px' }}>
                      <div style={{ background: 'var(--muted)', padding: '20px', borderRadius: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Est. Correction Cost</div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>₹{gap.totalCorrectionCost.toLocaleString()}</div>
                        <div style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>for {profile.acres} acres</div>
                      </div>
                      <div style={{ background: 'var(--muted)', padding: '20px', borderRadius: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--muted-foreground)', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>Est. Prep Time</div>
                        <div style={{ fontSize: '24px', fontWeight: 700 }}>{gap.maxDaysBeforeSowing} Days</div>
                        <div style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>before sowing</div>
                      </div>
                    </div>
                  )}

                  {decisionStatus !== 'not-currently-feasible' && (
                    <button 
                    className="btn btn-primary mobile-full-button" 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCrop(crop);
                      }}
                    >
                      Select {crop.name} & Continue <ArrowRight size={18} />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default CropDecision
