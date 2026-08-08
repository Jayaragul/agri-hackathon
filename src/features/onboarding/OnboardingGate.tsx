import React, { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { Loader2, Mic, Pencil, Sprout, Video, Volume2 } from 'lucide-react'
import { useOnboarding } from './useOnboarding'

/**
 * First-run gate shown before the rest of the app: a farmer opening Krishi Mitra for the very
 * first time is asked their name (by voice when Sarvam is configured, always with a plain text
 * fallback), then picks a primary mode — Audio (conversational voice) or Video (live camera,
 * Crop Doctor). Renders exactly once per device: gated on `farmStore.onboardingComplete` (see
 * `services/identity/farmerIdentity.ts`), so a returning farmer skips straight past this into the
 * app they already know.
 *
 * This component only renders — the name-capture state machine lives in `useOnboarding`. The
 * only thing kept here is the card's entrance animation, which is a DOM/ref concern and
 * genuinely belongs at the view layer, not in the hook.
 */

interface OnboardingGateProps {
  onModeChosen: (mode: 'audio' | 'video') => void
}

const OnboardingGate: React.FC<OnboardingGateProps> = ({ onModeChosen }) => {
  const {
    step,
    voiceReady,
    isRecording,
    isProcessing,
    nameDraft,
    setNameDraft,
    error,
    startRecording,
    stopRecording,
    confirmName,
    retryName,
  } = useOnboarding()
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cardRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(cardRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' })
    })
    return () => ctx.revert()
  }, [step])

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'linear-gradient(160deg, var(--background), var(--muted))',
      }}
    >
      <div ref={cardRef} className="card" style={{ maxWidth: '480px', width: '100%', padding: '32px', textAlign: 'center' }}>
        <div className="logo-emoji" style={{ background: 'var(--muted)', width: '56px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '16px', margin: '0 auto 16px' }}>
          🌾
        </div>
        <h1 style={{ fontSize: '22px', marginBottom: '4px' }}>
          Welcome to Krishi <span className="gradient-text">Mitra</span>
        </h1>

        {step === 'ask-name' && (
          <>
            <p style={{ color: 'var(--muted-foreground)', marginBottom: '24px', fontSize: '15px' }}>
              {voiceReady === false
                ? "Let's start with your name."
                : 'Tap the mic and tell us your name — just your name, that\'s it.'}
            </p>

            {voiceReady !== false && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isProcessing}
                  className="btn btn-primary"
                  style={{
                    width: '84px',
                    height: '84px',
                    borderRadius: '50%',
                    padding: 0,
                    fontSize: '28px',
                    background: isRecording ? 'var(--color-red-600, #EA4335)' : undefined,
                  }}
                >
                  {isProcessing ? <Loader2 size={28} className="spin" /> : <Mic size={28} />}
                </button>
                <span style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>
                  {isProcessing ? 'Listening…' : isRecording ? 'Recording — pauses when you stop talking' : 'Tap to speak'}
                </span>
              </div>
            )}

            {error && (
              <div className="alert alert-danger" style={{ marginBottom: '16px', textAlign: 'left' }}>
                <div className="alert-desc">{error}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Or type your name here"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && nameDraft.trim() && confirmName()}
                maxLength={80}
              />
              <button type="button" className="btn btn-secondary" style={{ width: 'auto', padding: '0 16px' }} disabled={!nameDraft.trim()} onClick={confirmName}>
                <Pencil size={16} /> Next
              </button>
            </div>
          </>
        )}

        {step === 'confirm-name' && (
          <>
            <p style={{ color: 'var(--muted-foreground)', marginBottom: '16px', fontSize: '15px' }}>Did we hear that right?</p>
            <input
              type="text"
              className="form-control"
              style={{ textAlign: 'center', fontSize: '18px', marginBottom: '20px' }}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={80}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={retryName}>
                Try again
              </button>
              <button type="button" className="btn btn-primary" style={{ flex: 1 }} disabled={!nameDraft.trim()} onClick={confirmName}>
                That's right
              </button>
            </div>
          </>
        )}

        {step === 'choose-mode' && (
          <>
            <p style={{ color: 'var(--muted-foreground)', marginBottom: '24px', fontSize: '15px' }}>
              How would you like to talk with Krishi Mitra?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                type="button"
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
                onClick={() => onModeChosen('audio')}
              >
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(66,133,244,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Volume2 size={22} color="var(--accent)" />
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>Audio Mode</div>
                  <div style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>Speak naturally — the easiest way to ask anything.</div>
                </div>
              </button>
              <button
                type="button"
                className="card"
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px', textAlign: 'left', cursor: 'pointer', border: '1px solid var(--border)' }}
                onClick={() => onModeChosen('video')}
              >
                <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'rgba(52,168,83,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Video size={22} color="var(--brand-green)" />
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>Video Mode</div>
                  <div style={{ fontSize: '13px', color: 'var(--muted-foreground)' }}>Point your camera at a crop for a live visit.</div>
                </div>
              </button>
            </div>
            <p style={{ marginTop: '20px', fontSize: '12px', color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Sprout size={14} /> You can switch modes anytime from the top bar.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default OnboardingGate
