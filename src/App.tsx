import React, { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { useFarmStore } from './state/farmStore'
import { Check, Mic, Sprout, Sun } from 'lucide-react'

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
import CropDoctor from './features/crop-doctor/CropDoctor'
import VoiceMode from './features/voice-mode/VoiceMode'
import OnboardingGate from './features/onboarding/OnboardingGate'

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
  const { stage, setStage, profile, selectedCrop, onboardingComplete, completeOnboarding } = useFarmStore()
  const mainRef = useRef<HTMLElement>(null)
  const lastWizardStage = useRef<(typeof STAGES)[number]['id']>('farm-profile')

  const isDigitalTwin = stage === 'digital-twin'
  const isAdvisor = stage === 'advisor'
  const isCropDoctor = stage === 'crop-doctor'
  const isAudioMode = stage === 'audio-mode'
  const isSpecialMode = isDigitalTwin || isAdvisor || isCropDoctor || isAudioMode
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
    if (isCropDoctor) return <CropDoctor onSwitchToAudio={() => setStage('audio-mode')} />
    if (isAudioMode) return <VoiceMode onSwitchToVideo={() => setStage('crop-doctor')} />
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

  if (!onboardingComplete) {
    return (
      <OnboardingGate
        onModeChosen={(mode) => {
          completeOnboarding()
          setStage(mode === 'audio' ? 'audio-mode' : 'crop-doctor')
        }}
      />
    )
  }

  return (
    <div className={`app-container${isAudioMode ? ' app-container-immersive' : ''}`}>
      <header className={`app-header${isAudioMode ? ' app-header-dark' : ''}`}>
        <img className="brand-logo brand-logo-header" src="/thulir-logo.png" alt="Thulir logo" />
        <div className="brand-lockup">
          <h1 style={{ fontSize: '24px' }}>Thulir</h1>
          <span>Smart farming, rooted locally</span>
        </div>
        <div className="header-actions" style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          {isSpecialMode ? (
            <button
              type="button"
              className={`btn btn-secondary${isAudioMode ? ' btn-secondary-dark' : ''}`}
              style={{ height: '40px', padding: '0 16px', fontSize: '14px' }}
              onClick={() => setStage(lastWizardStage.current)}
            >
              <Sun size={16} /> Back to Planner
            </button>
          ) : (
            <>
              {/* Icon-only by design — see the user's request to drop Ask Advisor/Crop Doctor as
                  separate top-level entries and keep just these two. Ask Advisor (stage
                  'advisor') and Crop Doctor (stage 'crop-doctor') are NOT deleted: Crop Doctor is
                  still one tap away via Audio Mode's own in-screen "Video" toggle
                  (VoiceMode's onSwitchToVideo), and both stages still render fine if reached any
                  other way — they're just no longer linked from this header. */}
              <button
                type="button"
                className="btn btn-secondary icon-nav-btn"
                onClick={() => setStage('digital-twin')}
                title="Digital Twin"
                aria-label="Digital Twin"
              >
                <Sprout size={20} />
              </button>
              <button
                type="button"
                className="btn btn-secondary icon-nav-btn"
                onClick={() => setStage('audio-mode')}
                title="Audio Mode"
                aria-label="Audio Mode"
              >
                <Mic size={20} />
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
      {/* Audio Mode and Crop Doctor already own their microphone lifecycle. Showing the global
          browser-speech command mic there creates two competing voice buttons, and the browser
          Web Speech API can fail even while the configured Sarvam conversation mic is healthy. */}
      {!isAudioMode && !isCropDoctor && <VoiceControlWidget />}

      {/* Persistent Disclaimer — omitted in Audio Mode: its own dark shell already carries an
          equivalent line ("Explains and personalizes...") in the same immersive surface, and a
          second, differently-themed white banner right below it is exactly the "white space
          breaking a full-bleed mobile screen" problem this mode is designed to avoid. */}
      {!isAudioMode && (
        <footer className="disclaimer-banner texture-dots print-hide">
          ⚠️ THULIR DEMONSTRATION ONLY.
          Recommendations are generated by AI. Do not use for real farming decisions without consulting a certified agronomist or local KVK extension officer.
        </footer>
      )}
    </div>
  )
}

export default App
