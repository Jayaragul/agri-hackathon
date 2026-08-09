import React, { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Bot, Loader2, Send, Sparkles } from 'lucide-react'
import { useFarmStore } from '../../state/farmStore'
import { getA2AOrchestrator } from '../../services/ai/a2a'
import type { AiSourceKind, FarmAdvisorAnswer } from '../../services/ai'
import { getSessionStorage } from '../../services/storage'
import type { ChatMessage } from '../../services/storage'
import { recallMemories, recordMemory } from '../../services/memory/memoryClient'
import { getFarmContextSnapshot } from '../../services/context/farmContext'
import { describeProactiveAlert } from '../../engine/proactiveEngine'
import { getWeatherProactiveAlerts } from '../../services/weather/weatherContext'
import { runFarmAdvisorToolLoop } from '../../services/ai/runtime/farmAdvisorTools'
import { marketplaceHandoff } from '../../services/marketplace/farmConnect'

/**
 * General "ask anything" farm advisor — open-ended, unlike the Cultivation Calendar's
 * per-day Q&A. Answers through the A2A orchestrator's `answer-farm-question` skill, grounded
 * in the local knowledge base (`services/advisor/farmKnowledgeBase.ts`) and, when available,
 * the farmer's own profile and top recommendation. See [[krishi-mitra-ai-boundary]] — this
 * screen never sees or touches a score, ranking, or financial figure.
 */

const SOURCE_LABEL: Record<AiSourceKind, string> = {
  gemini: 'Gemini',
  cache: 'Cache',
  local: 'Offline answer',
  unavailable: 'Unavailable',
}

const SUGGESTED_PROMPTS = [
  'Why is my soil pH important?',
  'What should I do about low nitrogen?',
  'When should I spray for pests?',
]

const FarmAdvisor: React.FC = () => {
  const { profile, selectedCrop, recommendations, farmerName, declaredSituation } = useFarmStore()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    getSessionStorage()
      .loadAdvisorMessages()
      .then((history) => {
        if (!cancelled) setMessages(history)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingHistory(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!listRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        listRef.current!.lastElementChild,
        { opacity: 0, y: 10 },
        { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' }
      )
    }, listRef)
    return () => ctx.revert()
  }, [messages.length])

  const ask = async (text?: string) => {
    const questionText = (text ?? question).trim()
    if (!questionText) return
    setQuestion('')
    setAsking(true)

    const storage = getSessionStorage()
    const topRecommendation = recommendations[0] ?? null
    const afterFarmer = await storage.appendAdvisorMessage({ role: 'farmer', text: questionText })
    setMessages(afterFarmer)
    void recordMemory('farmer', questionText)

    try {
      const memories = await recallMemories(questionText)
      const { recentEvents, upcomingAlerts } = getFarmContextSnapshot()
      const weatherAlerts = await getWeatherProactiveAlerts(profile?.region)
      const toolLoop = await runFarmAdvisorToolLoop(questionText, {
        crop: selectedCrop ?? null,
        profile: profile ?? null,
        topRecommendation,
        farmerName,
      })
      const outcome = await getA2AOrchestrator().dispatch<FarmAdvisorAnswer>('answer-farm-question', {
        question: questionText,
        profile: profile ?? null,
        crop: selectedCrop ?? null,
        topRecommendation,
        memories,
        farmerName,
        declaredSituation,
        recentEvents: recentEvents.map((e) => e.title),
        upcomingAlerts: [...upcomingAlerts, ...weatherAlerts].map(describeProactiveAlert),
        liveToolResults: toolLoop.toolContextLines,
      })
      const answerWithHandoff = marketplaceHandoff(outcome.data.answer, questionText)
      const afterAssistant = await storage.appendAdvisorMessage({
        role: 'assistant',
        text: answerWithHandoff,
        citedFacts: outcome.data.topics,
        source: outcome.source,
      })
      setMessages(afterAssistant)
      void recordMemory('assistant', answerWithHandoff)
    } catch {
      const afterAssistant = await storage.appendAdvisorMessage({
        role: 'assistant',
        text: 'Something went wrong answering that. Please try again.',
        source: 'unavailable',
      })
      setMessages(afterAssistant)
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="farm-advisor-shell" style={{ maxWidth: '760px', margin: '0 auto' }}>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">AI Farm Advisor</span>
      </div>

      <h2 style={{ marginBottom: '8px' }}>
        Ask <span className="gradient-text gradient-underline">anything</span>
      </h2>
      <p style={{ marginBottom: '24px', color: 'var(--muted-foreground)', fontSize: '16px' }}>
        Grounded in Thulir's verified knowledge base, personalized to your farm when you've entered one.
      </p>

      {messages.length === 0 && !loadingHistory && (
        <div className="farm-advisor-suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="btn btn-secondary" style={{ width: 'auto', height: '36px', padding: '0 14px', fontSize: '13px' }} onClick={() => ask(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: '20px', marginBottom: '20px' }}>
        <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '50vh', overflowY: 'auto', marginBottom: messages.length > 0 ? '16px' : 0 }}>
          {loadingHistory ? (
            <p style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>Loading conversation…</p>
          ) : messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--muted-foreground)' }}>
              <Bot size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
              <p style={{ fontSize: '14px', margin: 0 }}>Ask about soil, crops, pests, or irrigation to get started.</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'farmer' ? 'flex-end' : 'flex-start',
                  maxWidth: '85%',
                  background: m.role === 'farmer' ? 'var(--accent)' : 'var(--muted)',
                  color: m.role === 'farmer' ? '#fff' : 'var(--foreground)',
                  borderRadius: '12px',
                  padding: '10px 14px',
                }}
              >
                {m.text.split('\n').map((line, li) => (
                  <p key={li} style={{ margin: li === 0 ? 0 : '8px 0 0', fontSize: '14px' }}>{line || ' '}</p>
                ))}
                {m.role === 'assistant' && (m.source || (m.citedFacts && m.citedFacts.length > 0)) && (
                  <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {m.source && <span className="badge badge-accent">{SOURCE_LABEL[m.source as AiSourceKind] ?? m.source}</span>}
                    {m.citedFacts?.map((topic, ti) => (
                      <span key={ti} className="badge" style={{ background: 'var(--border)', color: 'var(--foreground)' }}>
                        {topic}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="farm-advisor-compose" style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="form-control"
            style={{ flex: 1 }}
            placeholder="Ask about soil, crops, pests, or irrigation…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            maxLength={600}
          />
          <button type="button" className="btn btn-primary" style={{ width: 'auto' }} disabled={asking || question.trim().length === 0} onClick={() => ask()}>
            {asking ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
            {asking ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>

      <div className="alert alert-info">
        <Sparkles size={20} style={{ flexShrink: 0, color: 'var(--accent)' }} />
        <div className="alert-desc">
          This advisor explains and personalizes — it never changes a crop score, a cost, or a safety threshold. Those always come from Thulir's deterministic engine.
        </div>
      </div>
    </div>
  )
}

export default FarmAdvisor
