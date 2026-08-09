import React, { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Camera, CheckCircle2, Loader2, Mic, PhoneOff, ShieldAlert, Stethoscope, Volume2 } from 'lucide-react'
import { useFarmStore } from '../../state/farmStore'
import { samplePests } from '../../data/sample/pests'
import { CropDoctorSession, type CropDoctorStatus, type TranscriptEntry } from '../../services/ai/live/CropDoctorSession'
import type { PestToolResult } from '../../services/ai/live/pestToolResolver'
import { getFarmContextSnapshot, summariseSituation, summariseSoilNumbers } from '../../services/context/farmContext'
import { describeProactiveAlert } from '../../engine/proactiveEngine'
import { getWeatherProactiveAlerts } from '../../services/weather/weatherContext'

/**
 * Live video+audio "Crop Doctor" — point the camera at the crop and talk. Built on
 * `CropDoctorSession`, which connects the browser directly to Gemini Live over an ephemeral,
 * server-minted token. Every pest match shown here is resolved against the SAME verified,
 * closed dataset `PestDefense.tsx` uses — the model only relays what the "Engine Verified" card
 * below actually contains, never its own invented guidance. See [[krishi-mitra-ai-boundary]].
 */

const STATUS_LABEL: Record<CropDoctorStatus, string> = {
  idle: 'Not started',
  connecting: 'Connecting…',
  connected: 'Live',
  reconnecting: 'Reconnecting…',
  closed: 'Ended',
  error: 'Error',
}

const STATUS_BADGE_CLASS: Record<CropDoctorStatus, string> = {
  idle: 'badge',
  connecting: 'badge badge-amber',
  connected: 'badge badge-green',
  reconnecting: 'badge badge-amber',
  closed: 'badge',
  error: 'badge badge-red',
}

interface CropDoctorProps {
  onSwitchToAudio?: () => void
}

const CropDoctor: React.FC<CropDoctorProps> = ({ onSwitchToAudio }) => {
  const { selectedCrop, logTimelineEvent } = useFarmStore()
  const videoRef = useRef<HTMLVideoElement>(null)
  const sessionRef = useRef<CropDoctorSession | null>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  const [status, setStatus] = useState<CropDoctorStatus>('idle')
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [resolved, setResolved] = useState<PestToolResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const candidates = selectedCrop ? samplePests.filter((p) => p.cropId === selectedCrop.id) : []

  useEffect(() => {
    return () => {
      sessionRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    if (transcriptEndRef.current) {
      gsap.fromTo(transcriptEndRef.current.previousElementSibling, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.25 })
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [transcript.length])

  const handleStart = async () => {
    if (!selectedCrop || !videoRef.current) return
    setErrorMessage(null)
    setResolved(null)
    setTranscript([])

    const context = getFarmContextSnapshot()
    const weatherAlerts = await getWeatherProactiveAlerts(context.profile?.region)
    const session = new CropDoctorSession(
      selectedCrop,
      candidates,
      {
        onStatusChange: setStatus,
        onTranscript: (entry) => setTranscript((prev) => [...prev, entry]),
        onPestResolved: (result) => {
          setResolved(result)
          // Reactive: an engine-verified match during a live call is exactly the "unpredicted
          // happened" case — record it so the General Farm Advisor's next answer (in any mode)
          // already knows about it, via `farmContext.ts`. Never logs an unmatched observation:
          // "no match" is not itself an event worth remembering.
          if (result.matched) {
            logTimelineEvent({
              mode: 'reactive',
              kind: 'observation',
              source: 'agent',
              title: `Crop Doctor matched: ${result.pestName}`,
              detail: [
                result.biologicalControl ? `Biological control: ${result.biologicalControl}.` : null,
                result.chemicalControl ? `Chemical (last resort): ${result.chemicalControl}.` : null,
                result.economicThreshold ? `Economic threshold: ${result.economicThreshold}.` : null,
              ]
                .filter(Boolean)
                .join(' '),
              cropId: selectedCrop.id,
            })
          }
        },
        onError: setErrorMessage,
      },
      {
        farmerName: context.farmerName ?? undefined,
        situation: summariseSituation(context),
        soilSummary: summariseSoilNumbers(context),
        recentEvents: context.recentEvents.map((e) => e.title),
        upcomingAlerts: [...context.upcomingAlerts, ...weatherAlerts].map(describeProactiveAlert),
      }
    )
    sessionRef.current = session

    try {
      await session.start(videoRef.current)
    } catch {
      // onError already surfaced the message; nothing further to do here.
    }
  }

  const handleStop = () => {
    sessionRef.current?.stop()
    sessionRef.current = null
  }

  if (!selectedCrop) {
    return (
      <div>
        <div className="section-badge">
          <span className="section-badge-dot pulse" />
          <span className="section-badge-text">Crop Doctor</span>
        </div>
        <h2 style={{ marginBottom: '16px' }}>Pick a crop first</h2>
        <p style={{ color: 'var(--muted-foreground)' }}>
          Crop Doctor checks what it sees against your selected crop's verified pest list — complete your farm profile and pick a crop before starting a live call.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div className="section-badge">
          <span className="section-badge-dot pulse" />
          <span className="section-badge-text">Crop Doctor · Live</span>
        </div>
        {onSwitchToAudio && (
          <button type="button" className="btn btn-secondary" style={{ width: 'auto', height: '32px', padding: '0 12px', fontSize: '13px' }} onClick={onSwitchToAudio}>
            <Volume2 size={14} /> Switch to Audio
          </button>
        )}
      </div>

      <h2 style={{ marginBottom: '8px' }}>
        Point your camera at your <span className="gradient-text gradient-underline">{selectedCrop.name}</span>
      </h2>
      <p style={{ marginBottom: '24px', color: 'var(--muted-foreground)', fontSize: '16px' }}>
        Talk naturally — Crop Doctor watches and listens live, and only relays guidance already verified for {selectedCrop.name}'s known pests.
      </p>

      <div className="card" style={{ padding: '16px' }}>
        <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', background: 'var(--foreground)', aspectRatio: '4 / 3' }}>
          <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: status === 'idle' ? 'none' : 'block' }} />
          {status === 'idle' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--background)' }}>
              <Stethoscope size={40} style={{ opacity: 0.6 }} />
              <span style={{ fontSize: '14px', opacity: 0.8 }}>Camera preview appears here</span>
            </div>
          )}
          <span className={STATUS_BADGE_CLASS[status]} style={{ position: 'absolute', top: '12px', right: '12px' }}>
            {STATUS_LABEL[status]}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          {status === 'idle' || status === 'closed' || status === 'error' ? (
            <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={handleStart}>
              <Camera size={18} /> <Mic size={18} /> Start Live Visit
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" style={{ flex: 1, background: 'var(--color-red-600)', color: '#fff' }} onClick={handleStop}>
              {status === 'connecting' || status === 'reconnecting' ? <Loader2 size={18} className="spin" /> : <PhoneOff size={18} />}
              {status === 'connecting' ? 'Connecting…' : status === 'reconnecting' ? 'Reconnecting…' : 'End Visit'}
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="alert alert-danger" style={{ marginTop: '16px' }}>
            <ShieldAlert size={20} style={{ flexShrink: 0 }} />
            <div className="alert-desc">{errorMessage}</div>
          </div>
        )}
      </div>

      {resolved && (
        <div className="card" style={{ marginTop: '20px', border: resolved.matched ? '1px solid var(--brand-green)' : '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <CheckCircle2 size={20} color={resolved.matched ? 'var(--brand-green)' : 'var(--muted-foreground)'} />
            <h3 style={{ margin: 0, fontSize: '18px' }}>{resolved.matched ? `Engine verified: ${resolved.pestName}` : 'No verified match yet'}</h3>
          </div>
          {resolved.matched ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
              <div><strong>Biological control:</strong> {resolved.biologicalControl}</div>
              {resolved.chemicalControl && <div><strong>Chemical control (last resort):</strong> {resolved.chemicalControl}</div>}
              <div><strong>Economic threshold:</strong> {resolved.economicThreshold}</div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: '14px', color: 'var(--muted-foreground)' }}>{resolved.note}</p>
          )}
        </div>
      )}

      {transcript.length > 0 && (
        <div className="card" style={{ marginTop: '20px' }}>
          <div style={{ ...({} as React.CSSProperties), fontFamily: 'var(--font-mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', marginBottom: '12px' }}>
            Live transcript
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '260px', overflowY: 'auto' }}>
            {transcript.map((entry, i) => (
              <div
                key={i}
                style={{
                  alignSelf: entry.speaker === 'farmer' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: entry.speaker === 'farmer' ? 'var(--accent)' : 'var(--muted)',
                  color: entry.speaker === 'farmer' ? '#fff' : 'var(--foreground)',
                  borderRadius: '12px',
                  padding: '8px 12px',
                  fontSize: '14px',
                }}
              >
                {entry.text}
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      )}

      <div className="alert alert-info" style={{ marginTop: '24px' }}>
        <ShieldAlert size={20} style={{ flexShrink: 0, color: 'var(--accent)' }} />
        <div className="alert-desc">
          Crop Doctor only matches against {selectedCrop.name}'s verified pest list — it never invents a pest, a chemical, or a dose. For anything uncertain, show your local KVK extension officer too.
        </div>
      </div>
    </div>
  )
}

export default CropDoctor
