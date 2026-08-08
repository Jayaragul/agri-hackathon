import React, { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useFarmStore } from './state/farmStore'
import { Bot, Check, Sprout, Sun } from 'lucide-react'

// Domain Features
import FarmProfileForm from './features/farm-profile/FarmProfileForm'
import CropDecision from './features/crop-decision/CropDecision'
import SoilCorrections from './features/soil-preparation/SoilCorrections'
import Financials from './features/financial-plan/Financials'
import PestDefense from './features/pest-defense/PestDefense'
import PrintableActionPlan from './features/action-plan/PrintableActionPlan'
import CropCalendar from './features/crop-calendar/CropCalendar'
import AiTracePanel from './features/ai-trace/AiTracePanel'
import VoiceControlWidget from './features/voice-control/VoiceControlWidget'
import DigitalTwinFeature from './features/digital-twin'
import FarmAdvisor from './features/farm-advisor/FarmAdvisor'

const STAGES = [
  { id: 'farm-profile', label: 'Soil Data' },
  { id: 'recommendations', label: 'Crop Match' },
  { id: 'soil-corrections', label: 'Soil Fix' },
  { id: 'financials', label: 'Profit' },
  { id: 'pests', label: 'Pest Risk' },
  { id: 'action-plan', label: 'Action Plan' },
  { id: 'calendar', label: 'Calendar' }
] as const

function App() {
  const { stage, setStage, profile, selectedCrop } = useFarmStore()
  const mainRef = useRef<HTMLElement>(null)
  const lastWizardStage = useRef<(typeof STAGES)[number]['id']>('farm-profile')

  const isDigitalTwin = stage === 'digital-twin'
  const isAdvisor = stage === 'advisor'
  const isSpecialMode = isDigitalTwin || isAdvisor
  const currentStageIndex = STAGES.findIndex(s => s.id === stage)
  if (!isSpecialMode && currentStageIndex >= 0) {
    lastWizardStage.current = stage as (typeof STAGES)[number]['id']
  }

  // Minimal, single fade+rise on every stage change - keeps navigation feeling immediate
  // rather than decorative. Scoped to `mainRef` so it never touches the header/stepper/footer.
  useEffect(() => {
    if (!mainRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(mainRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' })
    })
    return () => ctx.revert()
  }, [stage])

  const renderStage = () => {
    if (isDigitalTwin) return <DigitalTwinFeature />
    if (isAdvisor) return <FarmAdvisor />
    switch (stage) {
      case 'farm-profile':
        return <FarmProfileForm />
      case 'recommendations':
        return <CropDecision />
      case 'soil-corrections':
        return <SoilCorrections />
      case 'financials':
        return <Financials />
      case 'pests':
        return <PestDefense />
      case 'action-plan':
        return <PrintableActionPlan />
      case 'calendar':
        return <CropCalendar />
      default:
        return <FarmProfileForm />
    }
  }

  // Navigation guards
  const handleStepClick = (idx: number, targetStageId: typeof STAGES[number]['id']) => {
    if (idx > currentStageIndex) {
      // Trying to jump forward
      if (idx > 0 && !profile) return // Need profile for anything past step 0
      if (idx > 1 && !selectedCrop) return // Need crop for anything past step 1
    }
    setStage(targetStageId)
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-emoji" style={{ background: 'var(--muted)', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>🌾</div>
        <div>
          <h1 style={{ fontSize: '24px' }}>Krishi <span className="gradient-text">Mitra</span></h1>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {isSpecialMode ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ height: '40px', padding: '0 16px', fontSize: '14px' }}
              onClick={() => setStage(lastWizardStage.current)}
            >
              <Sun size={16} /> Back to Planner
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '40px', padding: '0 16px', fontSize: '14px' }}
                onClick={() => setStage('advisor')}
              >
                <Bot size={16} /> Ask Advisor
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ height: '40px', padding: '0 16px', fontSize: '14px' }}
                onClick={() => setStage('digital-twin')}
              >
                <Sprout size={16} /> Digital Twin
              </button>
            </>
          )}
        </div>
      </header>

      {!isSpecialMode && (
        <div className="progress-stepper">
          {STAGES.map((s, idx) => {
            const isActive = stage === s.id
            const isCompleted = idx < currentStageIndex

            let statusClass = ''
            if (isActive) statusClass = 'active'
            else if (isCompleted) statusClass = 'completed'

            return (
              <div
                key={s.id}
                className={`step-item ${statusClass}`}
                onClick={() => handleStepClick(idx, s.id)}
                style={{ cursor: (idx <= currentStageIndex || (idx === 1 && profile) || (idx > 1 && selectedCrop)) ? 'pointer' : 'default' }}
              >
                <div className="step-number">
                  {isCompleted ? <Check size={14} /> : (idx + 1)}
                </div>
                <span>{s.label}</span>
              </div>
            )
          })}
        </div>
      )}

      <main className="main-content" ref={mainRef}>
        {renderStage()}
      </main>

      <AiTracePanel />
      <VoiceControlWidget />

      {/* Persistent Disclaimer */}
      <footer className="disclaimer-banner texture-dots print-hide">
        ⚠️ KRISHI MITRA DEMONSTRATION ONLY.
        Recommendations are generated by AI. Do not use for real farming decisions without consulting a certified agronomist or local KVK extension officer.
      </footer>
    </div>
  )
}

export default App
