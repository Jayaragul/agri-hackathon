import React from 'react'
import { Mic, Video } from 'lucide-react'

/**
 * Minimal text tabs for flipping between the app's two primary interaction modes — Audio and
 * Video — without returning to the header. Used inside `VoiceMode.tsx`, on the dark
 * `.voice-shell` surface it was designed for (see `styles/globals.css`'s `.voice-mode-tabs`).
 * Deliberately no pill/card chrome — just the active tab underlined — so it doesn't compete with
 * the orb for visual weight. Purely a navigation affordance: it never itself decides anything,
 * just calls back with the tapped mode.
 */

export type PrimaryMode = 'audio' | 'video'

interface GlassModeToggleProps {
  active: PrimaryMode
  onChange: (mode: PrimaryMode) => void
}

const GlassModeToggle: React.FC<GlassModeToggleProps> = ({ active, onChange }) => (
  <div className="voice-mode-tabs">
    <button
      type="button"
      className={`voice-mode-tab${active === 'audio' ? ' active' : ''}`}
      onClick={() => onChange('audio')}
    >
      <Mic size={13} /> Audio
    </button>
    <button
      type="button"
      className={`voice-mode-tab${active === 'video' ? ' active' : ''}`}
      onClick={() => onChange('video')}
    >
      <Video size={13} /> Video
    </button>
  </div>
)

export default GlassModeToggle
