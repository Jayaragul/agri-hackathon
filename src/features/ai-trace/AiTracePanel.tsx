import React, { useEffect, useState } from 'react'
import { Activity, ChevronDown, ChevronRight, Trash2, Wrench, X } from 'lucide-react'
import { getAiStatus, getAiTelemetry } from '../../services/ai'
import type { AiCallRecord, AiSourceKind } from '../../services/ai'

/** Truncate long prompt/response text for display; the full value is still in the record for anyone reading it programmatically. */
const MAX_DISPLAY_CHARS = 1200
function truncate(text: string | undefined): string {
  if (!text) return ''
  return text.length > MAX_DISPLAY_CHARS ? `${text.slice(0, MAX_DISPLAY_CHARS)}\n… (truncated)` : text
}

const preStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '10px',
  margin: 0,
  maxHeight: '220px',
  overflowY: 'auto'
}

/**
 * Full "what happened" detail for one call: the request that was (or would have been) sent,
 * the raw response text and validated data, every tool call, and the harness's own reasoning
 * trail (cache hits, retries, repairs, fallback reasons) in order.
 */
const RecordDetails: React.FC<{ record: AiCallRecord }> = ({ record }) => (
  <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {record.notes.length > 0 && (
      <div>
        <div style={{ ...monoLabel, marginBottom: '6px' }}>Reasoning trail</div>
        <ol style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--foreground)' }}>
          {record.notes.map((note, i) => (
            <li key={i} style={{ marginBottom: '4px' }}>{note}</li>
          ))}
        </ol>
      </div>
    )}

    {record.request && (
      <div>
        <div style={{ ...monoLabel, marginBottom: '6px' }}>
          Request{record.request.imageCount > 0 ? ` · ${record.request.imageCount} image(s): ${record.request.imageMimeTypes.join(', ')}` : ''}
          {record.request.useSearchGrounding ? ' · search grounding requested' : ''}
        </div>
        <pre style={preStyle}>{`SYSTEM:\n${truncate(record.request.system)}\n\nUSER:\n${truncate(record.request.user)}`}</pre>
      </div>
    )}

    <div>
      <div style={{ ...monoLabel, marginBottom: '6px' }}>Response</div>
      {record.response.rawText ? (
        <pre style={preStyle}>{`RAW:\n${truncate(record.response.rawText)}\n\nPARSED:\n${truncate(JSON.stringify(record.response.parsedData, null, 2))}`}</pre>
      ) : (
        <pre style={preStyle}>{truncate(JSON.stringify(record.response.parsedData, null, 2)) || 'No data.'}</pre>
      )}
    </div>

    {record.toolCalls.length > 0 && (
      <div>
        <div style={{ ...monoLabel, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Wrench size={12} /> Tool calls
        </div>
        {record.toolCalls.map((tool, i) => (
          <pre key={i} style={preStyle}>{`${tool.name} @ ${tool.timestamp}\n${truncate(JSON.stringify({ input: tool.input, output: tool.output }, null, 2))}`}</pre>
        ))}
      </div>
    )}
  </div>
)

/**
 * Live, honest view of every AI call the harness has made this session.
 *
 * This panel exists so a farmer (or a judge) can never mistake a model answer for a
 * deterministic one. Each row states exactly where the answer came from: a live Gemini call, a
 * replay of a previously validated response, or the offline deterministic fallback. It reads
 * `HarnessTelemetry` and nothing else - it can never influence a score, a ranking or a number.
 *
 * It carries `print-hide` because nothing scopes printing to `.printable-plan`; without it this
 * debug surface would be printed onto the farmer's action plan.
 */

type AiStatus = {
  configured: boolean
  live: boolean
  modelId: string
  transportId: string | null
}

const SOURCE_BADGE_CLASS: Record<AiSourceKind, string> = {
  gemini: 'badge-accent',
  cache: 'badge-green',
  local: 'badge-amber',
  unavailable: 'badge-red'
}

const SOURCE_LABEL: Record<AiSourceKind, string> = {
  gemini: 'Gemini',
  cache: 'Cache',
  local: 'Offline',
  unavailable: 'None'
}

const FALLBACK_STATUS: AiStatus = {
  configured: false,
  live: false,
  modelId: '',
  transportId: null
}

/** Status snapshot that can never throw into render. */
function readStatus(): AiStatus {
  try {
    return getAiStatus()
  } catch {
    return FALLBACK_STATUS
  }
}

const monoLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--muted-foreground)'
}

const AiTracePanel: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<AiCallRecord[]>([])
  const [status, setStatus] = useState<AiStatus>(FALLBACK_STATUS)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const toggleExpanded = (sequence: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(sequence)) next.delete(sequence)
      else next.add(sequence)
      return next
    })
  }

  // Subscribe to the shared telemetry log. `getRecords()` returns a fresh array each call, so we
  // mirror it into state on every notification rather than using `useSyncExternalStore` (whose
  // snapshot must be referentially stable).
  useEffect(() => {
    let cancelled = false

    let telemetry: ReturnType<typeof getAiTelemetry> | null = null
    try {
      telemetry = getAiTelemetry()
    } catch {
      telemetry = null
    }
    if (!telemetry) {
      setStatus(readStatus())
      return
    }

    const log = telemetry
    const sync = () => {
      if (cancelled) return
      try {
        setRecords(log.getRecords())
      } catch {
        setRecords([])
      }
      setStatus(readStatus())
    }

    sync()
    const unsubscribe = log.subscribe(sync)
    return () => {
      cancelled = true
      try {
        unsubscribe()
      } catch {
        // Ignore - the panel is going away regardless.
      }
    }
  }, [])

  const handleClear = () => {
    try {
      getAiTelemetry().clear()
    } catch {
      setRecords([])
    }
  }

  const liveCount = records.filter(r => r.source === 'gemini').length
  const degradedCount = records.filter(r => r.degraded).length

  let statusLabel = 'AI off'
  let statusClass = 'badge badge-amber'
  if (status.live) {
    statusLabel = 'Live'
    statusClass = 'badge badge-green'
  } else if (status.configured) {
    statusLabel = 'Configured'
    statusClass = 'badge badge-amber'
  } else {
    statusLabel = 'Offline mode'
    statusClass = 'badge badge-red'
  }

  if (!open) {
    return (
      <div
        className="print-hide"
        style={{ position: 'fixed', right: '20px', bottom: '20px', zIndex: 30 }}
      >
        <button
          type="button"
          className="btn btn-secondary"
          style={{ height: '40px', padding: '0 16px', fontSize: '14px', boxShadow: 'var(--shadow-lg)' }}
          onClick={() => setOpen(true)}
          aria-label="Open the AI call trace"
        >
          <Activity size={16} />
          Antigravity ADK Trace
          <span className={statusClass} style={{ marginLeft: '4px' }}>
            {records.length}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className="print-hide"
      style={{
        position: 'fixed',
        right: '20px',
        bottom: '20px',
        zIndex: 30,
        width: 'min(440px, calc(100vw - 40px))',
        maxHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-xl)',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <Activity size={18} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--foreground)' }}>
            Antigravity ADK Agent Trace
          </div>
          <div style={monoLabel}>Multi-agent trajectory & telemetry</div>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ height: '32px', width: '32px', padding: 0 }}
          onClick={handleClear}
          aria-label="Clear the AI call trace"
          title="Clear log"
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ height: '32px', width: '32px', padding: 0 }}
          onClick={() => setOpen(false)}
          aria-label="Close the AI call trace"
        >
          <X size={14} />
        </button>
      </div>

      {/* Status line */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--muted)',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <span className={statusClass}>{statusLabel}</span>
        <span style={{ ...monoLabel, textTransform: 'none' }}>
          {status.modelId || 'no model'}
        </span>
        <span style={monoLabel}>·</span>
        <span style={{ ...monoLabel, textTransform: 'none' }}>
          {status.transportId ?? 'no transport'}
        </span>
        <span style={{ ...monoLabel, marginLeft: 'auto', textTransform: 'none' }}>
          {records.length} calls · {liveCount} live · {degradedCount} degraded
        </span>
      </div>

      {/* Records, newest first */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {records.length === 0 ? (
          <div
            style={{
              padding: '32px 20px',
              textAlign: 'center',
              fontSize: '14px',
              color: 'var(--muted-foreground)'
            }}
          >
            No AI calls yet. Every call this app makes will appear here with its source.
          </div>
        ) : (
          records
            .slice()
            .reverse()
            .map(record => {
              const isExpanded = expanded.has(record.sequence)
              return (
              <div
                key={record.sequence}
                style={{
                  padding: '14px 20px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
                  onClick={() => toggleExpanded(record.sequence)}
                  role="button"
                  aria-expanded={isExpanded}
                  aria-label={`Toggle details for call #${record.sequence}`}
                >
                  {isExpanded ? <ChevronDown size={14} style={{ flexShrink: 0, color: 'var(--muted-foreground)' }} /> : <ChevronRight size={14} style={{ flexShrink: 0, color: 'var(--muted-foreground)' }} />}
                  <span style={{ ...monoLabel, minWidth: '28px' }}>#{record.sequence}</span>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      flex: 1,
                      minWidth: 0
                    }}
                  >
                    {record.label}
                  </span>
                  {record.toolCalls.length > 0 && <Wrench size={14} style={{ color: 'var(--muted-foreground)' }} />}
                  <span className={`badge ${SOURCE_BADGE_CLASS[record.source] ?? 'badge-amber'}`}>
                    {SOURCE_LABEL[record.source] ?? record.source}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '4px 14px',
                    ...monoLabel,
                    textTransform: 'none'
                  }}
                >
                  <span>{record.modelId ?? 'no model'}</span>
                  <span>{Math.round(record.latencyMs)} ms</span>
                  <span>
                    {record.attempts} {record.attempts === 1 ? 'attempt' : 'attempts'}
                  </span>
                  <span>{record.taskId}</span>
                </div>

                {(record.degraded || record.validationRepaired || !record.ok) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {record.degraded && <span className="badge badge-amber">Degraded</span>}
                    {record.validationRepaired && (
                      <span className="badge badge-amber">Schema repaired</span>
                    )}
                    {!record.ok && <span className="badge badge-red">Failed</span>}
                  </div>
                )}

                {record.errorMessage && (
                  <div style={{ fontSize: '12px', color: 'var(--color-red-600)' }}>
                    {record.errorMessage}
                  </div>
                )}

                {isExpanded && <RecordDetails record={record} />}
              </div>
              )
            })
        )}
      </div>

      {/* Footer: the architectural promise, stated where it is checkable */}
      <div
        style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'var(--muted)',
          fontSize: '12px',
          color: 'var(--muted-foreground)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <ChevronDown size={14} style={{ flexShrink: 0 }} />
        <span>
          The engine decides every score, cost and safety threshold. AI only explains and reads
          photos.
        </span>
      </div>
    </div>
  )
}

export default AiTracePanel
