import { FormEvent, useState } from 'react'
import { Bot, Send, Sparkles } from 'lucide-react'
import { useFarmStore } from '../../state/farmStore'
import { answerFarmQuestion, askLiveFarmAdvisor, AdvisorReply } from '../../services/advisor/localFarmAdvisor'

const PROMPTS = [
  'Why is my soil pH important?',
  'What should I do about low nitrogen?',
  'When should I spray for pests?',
]

export default function FarmAdvisor() {
  const { profile, selectedCrop, recommendations } = useFarmStore()
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<AdvisorReply | null>(null)
  const [isThinking, setIsThinking] = useState(false)

  const ask = async (event?: FormEvent, prompt?: string) => {
    event?.preventDefault()
    const text = (prompt ?? question).trim()
    if (!text) return

    setIsThinking(true)
    try {
      setReply(await askLiveFarmAdvisor(text, profile, selectedCrop, recommendations[0]))
    } catch {
      setReply({
        ...answerFarmQuestion(text, profile, selectedCrop, recommendations[0]),
        notice: 'Live Gemini is not configured or could not be reached. Showing verified offline guidance.',
      })
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <section className="advisor-card" aria-label="AI Farm Advisor">
      <div className="advisor-heading">
        <div className="advisor-icon"><Bot size={22} /></div>
        <div>
          <div className="section-badge" style={{ marginBottom: 6 }}>
            <Sparkles size={13} /><span>GOOGLE GEMINI AI</span>
          </div>
          <h2>Thulir Advisory</h2>
          <p>Ask Gemini for practical guidance grounded in your farm profile and Thulir's deterministic decision engines.</p>
        </div>
      </div>

      <div className="advisor-prompts">
        {PROMPTS.map(prompt => (
          <button key={prompt} type="button" onClick={() => { setQuestion(prompt); void ask(undefined, prompt) }}>
            {prompt}
          </button>
        ))}
      </div>

      <form className="advisor-form" onSubmit={ask}>
        <input
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder="Ask about soil, crops, pests, or irrigation…"
          aria-label="Ask the farm advisor"
          maxLength={600}
        />
        <button className="btn btn-primary" type="submit" aria-label="Ask advisor" disabled={isThinking}>
          <Send size={17} /> {isThinking ? 'Asking Gemini…' : 'Ask Gemini'}
        </button>
      </form>

      {reply && (
        <div className="advisor-reply">
          <div className="advisor-reply-meta">
            <span>Advisor response</span>
            <span className={`badge ${reply.provider === 'gemini' ? 'badge-accent' : 'badge-amber'}`}>
              {reply.provider === 'gemini' ? `Live ${reply.model || 'Gemini'}` : 'Offline fallback'}
            </span>
          </div>
          {reply.notice && (
            <div className="alert alert-warning" style={{ marginTop: '12px', marginBottom: 0 }}>
              <div className="alert-desc">{reply.notice}</div>
            </div>
          )}
          <div className="advisor-answer">
            {reply.answer.split('\n').map((line, index) => <p key={`${line}-${index}`}>{line || '\u00a0'}</p>)}
          </div>
          <div className="advisor-topics">Context used: {reply.topics.join(' · ')}</div>
        </div>
      )}
    </section>
  )
}
