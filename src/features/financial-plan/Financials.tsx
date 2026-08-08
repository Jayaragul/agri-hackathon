import React, { useMemo, useState } from 'react'
import { useFarmStore } from '../../state/farmStore'
import { analyzeSoilGaps } from '../../engine/soilGapAnalysis'
import { generateFinancialScenarios } from '../../engine/financialEngine'
import { spreadsheetCorrections } from '../../data/spreadsheetData'
import { ArrowRight, IndianRupee, TrendingUp, TrendingDown, Info } from 'lucide-react'

const Financials: React.FC = () => {
  const { profile, selectedCrop, setStage, recommendations } = useFarmStore()
  const [activeTab, setActiveTab] = useState<'expected' | 'conservative' | 'optimistic'>('expected')

  const { analysis, financials } = useMemo(() => {
    if (!profile || !selectedCrop) return { analysis: null, financials: null }
    const rec = recommendations.find(r => r.crop.id === selectedCrop.id)
    if (!rec) return { analysis: null, financials: null }

    const gapAnalysis = analyzeSoilGaps(profile, selectedCrop, spreadsheetCorrections, rec)
    const fin = generateFinancialScenarios(profile, selectedCrop, gapAnalysis)
    return { analysis: gapAnalysis, financials: fin }
  }, [profile, selectedCrop, recommendations])

  if (!profile || !selectedCrop || !analysis || !financials) return <div>Loading financials...</div>

  const activeScenario = financials[activeTab]
  const costRows = [
    ['Soil Correction', activeScenario.costBreakdown.soilCorrection],
    ['Seed & Fertilizer', activeScenario.costBreakdown.seed + activeScenario.costBreakdown.fertilizer],
    ['Labor & Operations', activeScenario.costBreakdown.labor + activeScenario.costBreakdown.irrigation + activeScenario.costBreakdown.machinery],
    ['Crop Protection', activeScenario.costBreakdown.pesticide],
    ['Post-harvest & Mandi', activeScenario.costBreakdown.postHarvest + activeScenario.costBreakdown.mandiCharges]
  ] as const

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Financial Forecast</span>
      </div>

      <h2 style={{ marginBottom: '24px' }}>
        Investment & <span className="gradient-text gradient-underline">Returns</span>
      </h2>
      <p style={{ marginBottom: '32px', color: 'var(--muted-foreground)', fontSize: '18px' }}>
        Estimated costs and returns for {profile.acres} acres of {selectedCrop.name}, including pre-farming soil correction costs.
      </p>

      {/* Scenario Tabs */}
      <div className="scenario-tabs" style={{ display: 'flex', gap: '12px', marginBottom: '32px', overflowX: 'auto', paddingBottom: '4px' }}>
        <button 
          className={`btn ${activeTab === 'conservative' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, minWidth: '140px' }}
          onClick={() => setActiveTab('conservative')}
        >
          Conservative
        </button>
        <button 
          className={`btn ${activeTab === 'expected' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, minWidth: '140px' }}
          onClick={() => setActiveTab('expected')}
        >
          Expected
        </button>
        <button 
          className={`btn ${activeTab === 'optimistic' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ flex: 1, minWidth: '140px' }}
          onClick={() => setActiveTab('optimistic')}
        >
          Optimistic
        </button>
      </div>

      {/* Main KPI - Inverted Design */}
      <div className={`card financial-kpi ${activeScenario.isLoss ? 'bg-inverted' : 'bg-inverted texture-dots'}`} style={{ textAlign: 'center', padding: '64px 24px', border: 'none', background: activeScenario.isLoss ? 'var(--color-red-700)' : 'var(--foreground)' }}>
        <div style={{ fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '16px', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
          Estimated Net Profit
        </div>
        <div className="financial-kpi-value" style={{ fontSize: '56px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'white', fontFamily: 'var(--font-display)' }}>
          <IndianRupee size={48} />
          {Math.abs(Math.round(activeScenario.netProfit)).toLocaleString()}
        </div>
        <div style={{ fontSize: '18px', marginTop: '16px', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontWeight: 600 }}>
          {activeScenario.isLoss ? (
            <><TrendingDown size={20} /> Projected Loss</>
          ) : (
            <><TrendingUp size={20} /> {activeScenario.roi.toFixed(1)}% Return on Investment</>
          )}
        </div>
      </div>

      {/* Breakdown Grid */}
      <h3 style={{ fontSize: '20px', marginBottom: '24px', marginTop: '48px', color: 'var(--foreground)' }}>Cost & Revenue Breakdown</h3>
      <div className="grid-2">
        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--muted-foreground)', fontSize: '16px' }}>Total Investment</span>
            <strong style={{ fontSize: '20px' }}>₹{Math.round(activeScenario.totalInvestment).toLocaleString()}</strong>
          </div>
          {costRows.map(([label, cost], index) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: index === costRows.length - 1 ? 0 : '16px', fontSize: '15px', color: 'var(--foreground)' }}>
              <span>{label}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>₹{Math.round(cost).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--muted-foreground)', fontSize: '16px' }}>Gross Revenue</span>
            <strong style={{ fontSize: '20px' }}>₹{Math.round(activeScenario.grossRevenue).toLocaleString()}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '15px', color: 'var(--foreground)' }}>
            <span>Saleable Yield</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(activeScenario.saleableYieldKg).toLocaleString()} kg</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '15px', color: 'var(--foreground)' }}>
            <span>Market Price</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>₹{activeScenario.effectivePricePerKg.toFixed(1)} / kg</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', color: 'var(--foreground)' }}>
            <span>Break-even Price</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>₹{activeScenario.breakEvenPricePerKg.toFixed(1)} / kg</span>
          </div>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginTop: '32px' }}>
        <Info size={24} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent)' }} />
        <div className="alert-desc">
          <strong>How is this calculated?</strong> The model takes standard district averages and adjusts them based on the selected scenario (Yield, Price, Input Costs). It explicitly subtracts your pre-farming soil correction costs from the profit.
        </div>
      </div>

      <button className="btn btn-primary mobile-full-button" onClick={() => setStage('pests')} style={{ marginTop: '24px', width: 'auto' }}>
        Review Pest Risks <ArrowRight size={18} />
      </button>
    </div>
  )
}

export default Financials
