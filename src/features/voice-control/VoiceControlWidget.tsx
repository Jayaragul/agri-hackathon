import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Volume2 } from 'lucide-react'
import { useFarmStore } from '../../state/farmStore'
import { getVoiceAgent } from '../../services/voice'
import { parseVoiceIntent, executeVoiceIntent } from '../../services/voice'

/**
 * Floating mic button: press to speak a command ("load demo", "show recommendations",
 * "read the result", "go back"), the app acts on it and speaks a short reply back.
 *
 * Talks to `farmStore` only through `executeVoiceIntent` - it never bypasses the same guards
 * (`handleStepClick` in `App.tsx`) that gate manual navigation, so a voice command cannot jump
 * ahead of a step the farmer hasn't unlocked yet.
 *
 * This widget IS the current voice agent (`WebSpeechVoiceAgent`, the browser's own speech
 * APIs). Swapping in a teammate's dedicated agent later means changing `services/voice/index.ts`
 * only - this component keeps working unmodified.
 */
const VoiceControlWidget: React.FC = () => {
  const { stage, profile, selectedCrop, recommendations, loadDemoProfile, setStage } = useFarmStore()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const contextRef = useRef({ stage, profile, selectedCrop, recommendations, loadDemoProfile, setStage })

  contextRef.current = { stage, profile, selectedCrop, recommendations, loadDemoProfile, setStage }

  useEffect(() => {
    setSupported(getVoiceAgent().isSupported())
  }, [])

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    setTranscript(text)
    if (!isFinal) return

    const intent = parseVoiceIntent(text)
    const spoken = executeVoiceIntent(intent, contextRef.current)
    setReply(spoken)
    setListening(false)
    getVoiceAgent().speak(spoken)
  }, [])

  const handleToggle = () => {
    const agent = getVoiceAgent()
    if (listening) {
      agent.stop()
      setListening(false)
      return
    }
    setTranscript('')
    setReply(null)
    setListening(true)
    agent.start(handleTranscript, (message) => {
      setReply(message)
      setListening(false)
    })
  }

  if (!supported) return null

  return (
    <div className="print-hide" style={{ position: 'fixed', left: '20px', bottom: '20px', zIndex: 30, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
      {(transcript || reply) && (
        <div
          style={{
            maxWidth: 'min(320px, calc(100vw - 40px))',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-lg)',
            padding: '12px 14px',
            fontSize: '13px',
            color: 'var(--foreground)'
          }}
        >
          {transcript && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', color: 'var(--muted-foreground)' }}>
              <Mic size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>&ldquo;{transcript}&rdquo;</span>
            </div>
          )}
          {reply && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: transcript ? '6px' : 0 }}>
              <Volume2 size={14} style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent)' }} />
              <span>{reply}</span>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleToggle}
        aria-label={listening ? 'Stop voice command' : 'Speak a voice command'}
        title={listening ? 'Listening... click to stop' : 'Click and speak a command'}
        style={{
          height: '48px',
          width: '48px',
          padding: 0,
          borderRadius: '999px',
          boxShadow: 'var(--shadow-lg)',
          background: listening ? 'var(--color-red-600, #dc2626)' : undefined,
          color: listening ? '#fff' : undefined
        }}
      >
        {listening ? <MicOff size={20} /> : <Mic size={20} />}
      </button>
    </div>
  )
}

export default VoiceControlWidget
