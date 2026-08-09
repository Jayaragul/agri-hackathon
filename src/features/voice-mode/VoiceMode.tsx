import React, { useEffect, useRef } from 'react'
import gsap from 'gsap'
import { FileText, Loader2, Mic, Send, Square } from 'lucide-react'
import { useVoiceConversation, PHASE_LABEL } from './useVoiceConversation'
import GlassModeToggle from '../../components/GlassModeToggle'

/**
 * Audio Mode's view. All conversation logic (the state machine, the mic lifecycle, dispatch,
 * memory, speech) lives in `useVoiceConversation` — this component only renders it.
 *
 * Layout: a pill-shaped compose bubble pinned to the top (type-to-ask, always visible, not a
 * secondary affordance), a standalone animated waveform as the state visualiser, and a separate
 * mic button beneath it — three distinct elements rather than one combined orb, matching the
 * reference layout. The waveform/mic still share the same state-driven color language as before
 * (`--orb-1`/`--orb-2`, set per phase) so idle/listening/thinking/speaking stay visually
 * consistent with the rest of the app; only the SHAPE changed, not the meaning of the color.
 */

const STATE_CLASS = (phase: string) =>
  `${phase === 'recording' ? ' recording' : ''}${phase === 'transcribing' || phase === 'thinking' ? ' thinking' : ''}${phase === 'speaking' ? ' speaking' : ''}`

interface VoiceModeProps {
  onSwitchToVideo: () => void
}

const VoiceMode: React.FC<VoiceModeProps> = ({ onSwitchToVideo }) => {
  const {
    phase,
    busy,
    voiceReady,
    errorMessage,
    greetingLine,
    answerText,
    messages,
    lastActivity,
    typedQuestion,
    setTypedQuestion,
    handleMicClick,
    handleSend,
    uploadLabReport,
    labReportStatus,
    labReportMessage,
  } = useVoiceConversation()
  const labReportInputRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const stateClass = STATE_CLASS(phase)

  useEffect(() => {
    if (!transcriptRef.current || messages.length === 0) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        transcriptRef.current!.lastElementChild,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
      )
    }, transcriptRef)
    return () => ctx.revert()
  }, [messages.length])

  useEffect(() => {
    if (!transcriptRef.current) return
    transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [messages.length])

  const handleLabReportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void uploadLabReport(file)
  }

  return (
    <div className="voice-shell">
      <input
        ref={labReportInputRef}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleLabReportChange}
      />
      <button
        type="button"
        className="voice-lab-report-btn"
        disabled={labReportStatus === 'uploading'}
        onClick={() => labReportInputRef.current?.click()}
        title="Add a photo or PDF of your soil test / lab report"
        aria-label="Add a photo or PDF of your soil test / lab report"
      >
        {labReportStatus === 'uploading' ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
        <span>Lab report</span>
      </button>

      <div style={{ width: '100%', maxWidth: '480px', display: 'flex', justifyContent: 'center', paddingTop: '8px', marginBottom: '20px' }}>
        <GlassModeToggle active="audio" onChange={(mode) => mode === 'video' && onSwitchToVideo()} />
      </div>

      <p className="voice-greeting">{greetingLine}</p>

      <div className="voice-top-bubble">
        <input
          type="text"
          placeholder="Ask me anything about your farm…"
          value={typedQuestion}
          onChange={(e) => setTypedQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          disabled={busy}
          maxLength={600}
        />
        <button type="button" className="voice-send-circle" onClick={handleSend} disabled={busy || !typedQuestion.trim()}>
          <Send size={16} />
        </button>
      </div>
      <span className="voice-handle-bar" />

      <div className="voice-transcript" ref={transcriptRef}>
        {messages.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'rgba(242,242,243,0.4)', textAlign: 'center', margin: 'auto' }}>
            {answerText || 'Ask me anything about your farm.'}
          </p>
        ) : (
          messages.map((m, i) => {
            const isLast = i === messages.length - 1
            return (
              <div key={i} className={`voice-msg ${m.role === 'farmer' ? 'voice-msg-farmer' : 'voice-msg-assistant'}`}>
                {m.text.split('\n').map((line, li) => (
                  <p key={li}>{line || ' '}</p>
                ))}
                {isLast && m.role === 'assistant' && lastActivity.length > 0 && (
                  <div className="voice-activity-row">
                    {lastActivity.map((a, ai) => (
                      <span key={ai} className="voice-activity-chip">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="voice-hero">
        <div className={`voice-waveform-wrap${stateClass}`}>
          <span className="voice-waveform-bar" />
          <span className="voice-waveform-bar" />
          <span className="voice-waveform-bar" />
          <span className="voice-waveform-bar" />
          <span className="voice-waveform-bar" />
        </div>

        <button
          type="button"
          onClick={handleMicClick}
          disabled={busy || voiceReady === false}
          className={`voice-mic-standalone${stateClass}`}
          aria-label={phase === 'recording' ? 'Stop recording' : 'Start voice question'}
          title={phase === 'recording' ? 'Stop recording' : 'Tap to ask Thulir by voice'}
        >
          {busy ? <Loader2 size={22} className="spin" /> : phase === 'recording' ? <Square size={18} /> : <Mic size={22} />}
        </button>

        <div>
          <p className="voice-phase-label">{PHASE_LABEL[phase]}</p>
          {errorMessage && (
            <p style={{ fontSize: '13px', color: '#F28B82', marginTop: '8px', maxWidth: '380px' }}>{errorMessage}</p>
          )}
          {voiceReady === false && !errorMessage && (
            <p style={{ fontSize: '12px', color: 'rgba(242,242,243,0.35)', marginTop: '8px' }}>Voice isn't set up on this server — type above instead.</p>
          )}
          {labReportMessage && !errorMessage && (
            <p
              style={{
                fontSize: '12px',
                color: labReportStatus === 'error' ? '#F28B82' : 'rgba(242,242,243,0.45)',
                marginTop: '8px',
                maxWidth: '340px',
              }}
            >
              {labReportMessage}
            </p>
          )}
        </div>
      </div>

      <span className="voice-handle-bar" style={{ marginBottom: '12px' }} />
      <p style={{ fontSize: '11px', color: 'rgba(242,242,243,0.3)', textAlign: 'center', paddingBottom: '20px' }}>
        Explains and personalizes — never changes a crop score, a cost, or a safety threshold.
      </p>
    </div>
  )
}

export default VoiceMode
