import React, { useEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { Bell, CalendarDays, ClipboardList, History, Loader2, MessageCircleQuestion, Plus, Sparkles } from 'lucide-react'
import { useFarmStore } from '../../state/farmStore'
import { parseIsoDate, type CalendarDay, type CropCalendarPhase } from '../../engine/cropCalendarEngine'
import { deriveCurrentCropCalendarPlan } from '../../engine/currentCropCalendar'
import { buildProactiveAlerts, describeProactiveAlert } from '../../engine/proactiveEngine'
import { getA2AOrchestrator } from '../../services/ai/a2a'
import type { AiSourceKind, CalendarAnswer } from '../../services/ai'
import { getSessionStorage } from '../../services/storage'
import type { CalendarChatMessage } from '../../services/storage'
import { recallMemories, recordMemory } from '../../services/memory/memoryClient'
import { getWeatherProactiveAlerts } from '../../services/weather/weatherContext'
import type { FarmTimelineEvent } from '../../domain/models/models'

/**
 * Day-by-day cultivation calendar, generated once profile + crop + soil corrections + pest
 * risk are all known. Every task/risk shown per day comes straight out of
 * `cropCalendarEngine.ts` (deterministic) — the only AI call this screen makes is the
 * "ask about this day" box, and it answers through the A2A orchestrator's
 * `answer-calendar-question` skill, grounded in that same day's data. See [[krishi-mitra-ai-boundary]].
 */

const PHASE_COLOR: Record<CropCalendarPhase, string> = {
  'soil-prep': 'var(--muted-foreground)',
  germination: 'var(--brand-yellow)',
  vegetative: 'var(--brand-green)',
  flowering: 'var(--brand-blue)',
  maturation: 'var(--color-amber-600)',
  'harvest-window': 'var(--brand-red)',
}

const WEEKDAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const SOURCE_LABEL: Record<AiSourceKind, string> = {
  gemini: 'Gemini',
  cache: 'Cache',
  local: 'Offline answer',
  unavailable: 'Unavailable',
}

interface MonthGroup {
  key: string
  label: string
  leadingBlanks: number
  days: CalendarDay[]
}

function groupByMonth(days: CalendarDay[]): MonthGroup[] {
  const groups = new Map<string, CalendarDay[]>()
  for (const day of days) {
    const key = day.dateIso.slice(0, 7)
    const list = groups.get(key) ?? []
    list.push(day)
    groups.set(key, list)
  }
  return Array.from(groups.entries()).map(([key, monthDays]) => {
    const firstDate = parseIsoDate(monthDays[0].dateIso)
    return {
      key,
      label: firstDate.toLocaleString('default', { month: 'long', year: 'numeric' }),
      leadingBlanks: firstDate.getDay(),
      days: monthDays,
    }
  })
}

const CropCalendar: React.FC = () => {
  const { profile, selectedCrop, recommendations, setStage, timelineEvents, logTimelineEvent } = useFarmStore()
  const [selectedDateIso, setSelectedDateIso] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [messages, setMessages] = useState<CalendarChatMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [journalNote, setJournalNote] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)

  const plan = useMemo(() => {
    if (!profile || !selectedCrop) return null
    const rec = recommendations.find((r) => r.crop.id === selectedCrop.id)
    if (!rec) return null
    return deriveCurrentCropCalendarPlan(profile, selectedCrop, rec)
  }, [profile, selectedCrop, recommendations])

  // Proactive: the same deterministic plan this screen renders, read 7 days forward from today —
  // see `engine/proactiveEngine.ts`. Recomputed on every render (cheap, pure) rather than cached,
  // since "today" changes underneath it.
  const calendarAlerts = useMemo(() => (plan ? buildProactiveAlerts(plan, new Date()) : []), [plan])

  // Weather is a live network fetch, so unlike `calendarAlerts` it can't be a plain useMemo —
  // see `services/weather/weatherContext.ts`. Resolves to `[]` with no region configured.
  const [weatherAlerts, setWeatherAlerts] = useState<FarmTimelineEvent[]>([])
  useEffect(() => {
    let cancelled = false
    getWeatherProactiveAlerts(profile?.region).then((alerts) => {
      if (!cancelled) setWeatherAlerts(alerts)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.region])

  const upcomingAlerts = useMemo(() => [...calendarAlerts, ...weatherAlerts], [calendarAlerts, weatherAlerts])

  const months = useMemo(() => (plan ? groupByMonth(plan.days) : []), [plan])
  const selectedDay = useMemo(
    () => (plan && selectedDateIso ? plan.days.find((d) => d.dateIso === selectedDateIso) ?? null : null),
    [plan, selectedDateIso]
  )

  useEffect(() => {
    if (!gridRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.calendar-day:not(.is-empty)',
        { opacity: 0, y: 8, scale: 0.9 },
        { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'power2.out', stagger: 0.006 }
      )
    }, gridRef)
    return () => ctx.revert()
  }, [plan])

  useEffect(() => {
    if (!selectedDay || !detailRef.current) return
    const ctx = gsap.context(() => {
      gsap.fromTo(detailRef.current, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' })
    }, detailRef)
    return () => ctx.revert()
  }, [selectedDay])

  const handleSelectDay = (day: CalendarDay) => {
    setSelectedDateIso(day.dateIso)
    setQuestion('')
    setMessages([])
    setLoadingHistory(true)
    getSessionStorage()
      .loadCalendarMessages(day.dateIso)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setLoadingHistory(false))
  }

  const handleAsk = async () => {
    if (!selectedDay || !selectedCrop || question.trim().length === 0) return
    const questionText = question.trim()
    setQuestion('')
    setAsking(true)

    const storage = getSessionStorage()
    const afterFarmer = await storage.appendCalendarMessage(selectedDay.dateIso, { role: 'farmer', text: questionText })
    setMessages(afterFarmer)
    void recordMemory('farmer', questionText)

    try {
      const memories = await recallMemories(questionText)
      const outcome = await getA2AOrchestrator().dispatch<CalendarAnswer>('answer-calendar-question', {
        crop: selectedCrop,
        day: selectedDay,
        question: questionText,
        memories,
      })
      const afterAssistant = await storage.appendCalendarMessage(selectedDay.dateIso, {
        role: 'assistant',
        text: outcome.data.answer,
        citedFacts: outcome.data.citedFacts,
        source: outcome.source,
      })
      setMessages(afterAssistant)
      void recordMemory('assistant', outcome.data.answer)
    } catch {
      const afterAssistant = await storage.appendCalendarMessage(selectedDay.dateIso, {
        role: 'assistant',
        text: 'Something went wrong answering that. Please try again.',
        source: 'unavailable',
      })
      setMessages(afterAssistant)
    } finally {
      setAsking(false)
    }
  }

  const handleAddJournalNote = () => {
    const text = journalNote.trim()
    if (!text) return
    logTimelineEvent({
      mode: 'reactive',
      kind: 'observation',
      source: 'farmer',
      title: text.length > 80 ? `${text.slice(0, 77)}...` : text,
      detail: text,
      cropId: selectedCrop?.id ?? null,
      dayIndex: selectedDay?.dayIndex ?? null,
    })
    setJournalNote('')
  }

  if (!profile || !selectedCrop || !plan) {
    return <div>Complete your farm profile and pick a crop first.</div>
  }

  return (
    <div>
      <div className="section-badge">
        <span className="section-badge-dot pulse" />
        <span className="section-badge-text">Cultivation Calendar</span>
      </div>

      <h2 style={{ marginBottom: '8px' }}>
        Day by day, <span className="gradient-text gradient-underline">{selectedCrop.name}</span>
      </h2>
      <p style={{ marginBottom: '24px', color: 'var(--muted-foreground)', fontSize: '16px' }}>
        Sowing {parseIsoDate(plan.sowingDateIso).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}
        {' · '}
        Harvest window {parseIsoDate(plan.harvestDateIso).toLocaleDateString('default', { day: 'numeric', month: 'short', year: 'numeric' })}
      </p>

      <div className="calendar-legend">
        {(Object.keys(PHASE_COLOR) as CropCalendarPhase[]).map((phase) => (
          <span key={phase} className="legend-chip">
            <span className="legend-dot" style={{ background: PHASE_COLOR[phase] }} />
            {phase.replace('-', ' ')}
          </span>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <ClipboardList size={20} color="var(--accent)" />
          <h3 style={{ margin: 0, fontSize: '18px' }}>Farm Journal</h3>
        </div>

        <div className="grid-2" style={{ gap: '20px', marginBottom: '20px' }}>
          <div>
            <strong
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: 'var(--muted-foreground)',
                marginBottom: '10px',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
              }}
            >
              <Bell size={14} /> Upcoming · predicted
            </strong>
            {upcomingAlerts.length === 0 ? (
              <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', margin: 0 }}>Nothing flagged in the next 7 days.</p>
            ) : (
              <ul style={{ paddingLeft: '18px', margin: 0, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {upcomingAlerts.slice(0, 5).map((a) => (
                  <li key={a.id}>{describeProactiveAlert(a)}</li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <strong
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                color: 'var(--muted-foreground)',
                marginBottom: '10px',
                fontFamily: 'var(--font-mono)',
                textTransform: 'uppercase',
              }}
            >
              <History size={14} /> Recent activity
            </strong>
            {timelineEvents.length === 0 ? (
              <p style={{ fontSize: '14px', color: 'var(--muted-foreground)', margin: 0 }}>
                Nothing logged yet — talk to Krishi Mitra in Audio Mode, or add a note below.
              </p>
            ) : (
              <ul style={{ paddingLeft: '18px', margin: 0, fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {timelineEvents.slice(0, 5).map((e) => (
                  <li key={e.id}>{e.title}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid var(--border)', paddingTop: '16px', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="form-control"
            style={{ flex: 1, minWidth: '200px' }}
            placeholder="Log something — e.g. sprayed neem oil today"
            value={journalNote}
            onChange={(e) => setJournalNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddJournalNote()}
            maxLength={200}
          />
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: 'auto' }}
            disabled={journalNote.trim().length === 0}
            onClick={handleAddJournalNote}
          >
            <Plus size={16} /> Log
          </button>
        </div>
      </div>

      <div ref={gridRef} style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '32px' }}>
        {months.map((month) => (
          <div key={month.key} className="card">
            <h3 style={{ marginBottom: '16px' }}>{month.label}</h3>
            <div className="calendar-weekdays">
              {WEEKDAY_LABELS.map((w) => (
                <span key={w} className="calendar-weekday">
                  {w}
                </span>
              ))}
            </div>
            <div className="calendar-grid">
              {Array.from({ length: month.leadingBlanks }).map((_, i) => (
                <div key={`blank-${i}`} className="calendar-day is-empty" />
              ))}
              {month.days.map((day) => (
                <div
                  key={day.dateIso}
                  className={`calendar-day${day.dateIso === selectedDateIso ? ' is-selected' : ''}`}
                  style={{ background: PHASE_COLOR[day.phase], color: day.phase === 'germination' || day.phase === 'maturation' ? 'var(--foreground)' : '#fff', opacity: 0.92 }}
                  onClick={() => handleSelectDay(day)}
                  title={day.phaseLabel}
                >
                  {parseIsoDate(day.dateIso).getDate()}
                  {day.isMilestone && <span className="milestone-dot" />}
                  {day.risks.length > 0 && <span className="risk-mark">⚠</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedDay && (
        <div ref={detailRef} className="card" style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <CalendarDays size={20} color="var(--accent)" />
            <h3 style={{ margin: 0 }}>
              {parseIsoDate(selectedDay.dateIso).toLocaleDateString('default', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>
              {selectedDay.phaseLabel}
            </span>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <strong style={{ fontSize: '13px', color: 'var(--muted-foreground)', display: 'block', marginBottom: '8px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              Today's tasks
            </strong>
            <ul style={{ paddingLeft: '20px', margin: 0, fontSize: '15px', color: 'var(--foreground)' }}>
              {selectedDay.tasks.length > 0 ? selectedDay.tasks.map((t, i) => <li key={i}>{t}</li>) : <li>No specific task scheduled.</li>}
            </ul>
          </div>

          {selectedDay.risks.length > 0 && (
            <div style={{ marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {selectedDay.risks.map((r) => (
                <span key={r} className="badge badge-red">
                  Watch: {r}
                </span>
              ))}
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <strong style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted-foreground)', marginBottom: '12px', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
              <MessageCircleQuestion size={16} /> Ask about this day
            </strong>

            {loadingHistory ? (
              <p style={{ fontSize: '14px', color: 'var(--muted-foreground)' }}>Loading conversation…</p>
            ) : (
              messages.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                  {messages.map((m, i) => (
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
                      <p style={{ margin: 0, fontSize: '14px' }}>{m.text}</p>
                      {m.role === 'assistant' && (m.source || (m.citedFacts && m.citedFacts.length > 0)) && (
                        <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {m.source && <span className="badge badge-accent">{SOURCE_LABEL[m.source as AiSourceKind] ?? m.source}</span>}
                          {m.citedFacts?.map((fact, fi) => (
                            <span key={fi} className="badge" style={{ background: 'var(--border)', color: 'var(--foreground)' }}>
                              {fact}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="form-control"
                style={{ flex: 1, minWidth: '200px' }}
                placeholder="e.g. What should I watch for today?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              />
              <button type="button" className="btn btn-primary" style={{ width: 'auto' }} disabled={asking || question.trim().length === 0} onClick={handleAsk}>
                {asking ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                Ask
              </button>
            </div>
          </div>
        </div>
      )}

      <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => setStage('action-plan')}>
        Back to Action Plan
      </button>
    </div>
  )
}

export default CropCalendar
