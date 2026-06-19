import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, CheckCircle, XCircle, Shield, RefreshCw } from 'lucide-react'

interface RemStep {
  order: number; action: string; command: string
  risk: 'SAFE' | 'DESTRUCTIVE'; reason: string
}
interface RemPlan { summary: string; steps: RemStep[] }

interface RemediationResult {
  thread_id: string; intent: string; domain: string
  opa_decision: 'ALLOW' | 'DENY' | 'NO_TOKEN' | 'ERROR' | 'PENDING' | string
  findings: string; plan: RemPlan
  status?: 'streaming' | 'done'
  raw_text?: string
}

function parseSummary(raw: string): { summary: string; steps?: RemStep[] } {
  if (raw.trimStart().startsWith('{')) {
    try { return JSON.parse(raw) } catch { /* fall through */ }
  }
  return { summary: raw }
}

function PlanView({ plan }: { plan: RemPlan }) {
  // Guard against double-encoded summary (JSON string in summary field)
  const resolved: RemPlan = (plan.steps?.length === 0 && typeof plan.summary === 'string')
    ? { ...parseSummary(plan.summary), steps: parseSummary(plan.summary).steps ?? [] }
    : plan
  const destructive = resolved.steps?.filter(s => s.risk === 'DESTRUCTIVE') ?? []
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-300 italic mb-3 leading-relaxed">{resolved.summary}</p>
      {destructive.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-orange-400 bg-orange-950/40 border border-orange-800/50 rounded-lg px-3 py-2 mb-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span><strong>{destructive.length}</strong> destructive operation{destructive.length > 1 ? 's' : ''} — requires zero-trust OBO chain token</span>
        </div>
      )}
      {(resolved.steps ?? []).map(s => (
        <div key={s.order} className={`rounded-lg border px-3 py-2.5 ${s.risk === 'DESTRUCTIVE' ? 'bg-red-950/30 border-red-800/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs font-mono text-gray-500 w-5">#{s.order}</span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
              s.risk === 'DESTRUCTIVE'
                ? 'bg-red-900/60 text-red-300 border border-red-700'
                : 'bg-emerald-900/40 text-emerald-400 border border-emerald-800'
            }`}>{s.risk}</span>
            <span className="text-sm text-gray-200 font-medium">{s.action}</span>
          </div>
          <code className={`block text-xs font-mono px-2.5 py-1.5 rounded mb-1.5 ${
            s.risk === 'DESTRUCTIVE' ? 'bg-red-900/30 text-red-200' : 'bg-gray-900 text-gray-300'
          }`}>{s.command}</code>
          <p className="text-[11px] text-gray-500 pl-1">{s.reason}</p>
        </div>
      ))}
    </div>
  )
}

function StreamingView({ raw_text }: { raw_text: string }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-1">
          {[0, 120, 240].map(d => (
            <span key={d} className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse inline-block"
              style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
        <span className="text-xs font-mono text-orange-400">Generating remediation plan…</span>
      </div>
      <pre className="text-[11px] font-mono text-gray-400 whitespace-pre-wrap leading-relaxed bg-gray-950 rounded-lg p-3 border border-gray-800 max-h-80 overflow-y-auto">
        {raw_text || ' '}
      </pre>
    </div>
  )
}

export default function RemediationPage() {
  const [result,   setResult]  = useState<RemediationResult | null>(null)
  const [lastPoll, setLastPoll] = useState<string>('')
  const [clearing, setClearing] = useState(false)

  const poll = useCallback(async () => {
    try {
      const r = await fetch('/sre-result')
      if (!r.ok) return
      const d = await r.json()
      if (d.status === 'ok' && d.data) setResult(d.data)
      setLastPoll(new Date().toLocaleTimeString('en-US', { hour12: false }))
    } catch { /* network error — keep previous state */ }
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(poll, 2000)
    const onVisible = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [poll])

  const handleClear = useCallback(async () => {
    setClearing(true)
    try {
      await fetch('/sre-result/clear', { method: 'DELETE' })
      setResult(null)
    } finally { setClearing(false) }
  }, [])

  const opaAllowed = result?.opa_decision === 'ALLOW'

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-600 to-red-700 flex items-center justify-center">
          <AlertTriangle className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">Remediation Agent</h1>
          <p className="text-[10px] text-gray-500 font-mono">:8085 · called by sre-agent via Envoy OBO chain · OPA-gated</p>
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Live poll indicator */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-600">
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse inline-block ${result?.status === 'streaming' ? 'bg-orange-500' : 'bg-emerald-500'}`} />
            {result?.status === 'streaming' ? 'streaming' : 'polling'} · {lastPoll || '—'}
          </div>

          {result && (
            <button
              onClick={handleClear} disabled={clearing}
              className="text-[11px] text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-3xl w-full mx-auto px-5 py-6 space-y-5">

        {/* No data yet */}
        {!result && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <div className="flex gap-1.5">
              {[0, 150, 300].map(d => (
                <div
                  key={d}
                  className="w-2 h-2 rounded-full bg-violet-700 animate-pulse"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
            <p className="text-gray-400 text-sm font-medium">Waiting for remediation task</p>
            <p className="text-gray-600 text-xs font-mono">
              Polling · results appear here when SRE Agent dispatches via OBO chain
            </p>
          </div>
        )}

        {/* Result */}
        {result && (
          <>
            {/* Chain metadata */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mb-1">Chain call received from sre-agent</p>
                  <p className="text-sm font-semibold text-white">{result.intent || 'Investigation'}</p>
                  <p className="text-xs text-gray-500 font-mono">{result.domain}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  {opaAllowed ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full bg-emerald-900/60 text-emerald-300 border border-emerald-700">
                      <CheckCircle className="w-3.5 h-3.5" /> OPA ALLOW
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-3 py-1 rounded-full bg-red-900/60 text-red-300 border border-red-700">
                      <XCircle className="w-3.5 h-3.5" /> OPA {result.opa_decision}
                    </span>
                  )}
                  <p className="text-[10px] text-gray-600 font-mono">thread: {result.thread_id?.slice(0, 12)}</p>
                </div>
              </div>

              {/* Zero-trust proof */}
              <div className="bg-gray-950 rounded-lg border border-gray-800 px-3 py-2 space-y-1 font-mono text-[10px]">
                <div className="flex gap-3 text-gray-600">
                  <span className="text-gray-500 w-32">caller identity</span>
                  <span className="text-violet-400">x-calling-agent: sre-agent</span>
                  <span className="text-gray-700">← injected by Envoy from OBO JWT</span>
                </div>
                <div className="flex gap-3 text-gray-600">
                  <span className="text-gray-500 w-32">target</span>
                  <span className="text-orange-400">x-target-agent: remediation-agent</span>
                  <span className="text-gray-700">← injected by Envoy header_mutation</span>
                </div>
                <div className="flex gap-3 text-gray-600">
                  <span className="text-gray-500 w-32">OPA rule</span>
                  <span className="text-gray-400">domain == "agent-to-agent" ∧ subject == "sre-agent" ∧ resource == "remediation-agent" ∧ effect == "allow"</span>
                </div>
              </div>
            </div>

            {/* OPA DENY state */}
            {!opaAllowed && (
              <div className="rounded-xl bg-red-950/40 border border-red-800/50 p-5">
                <p className="text-sm font-bold text-red-300 mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4" /> Chain Blocked by OPA
                </p>
                <p className="text-xs text-red-400">
                  No allow policy found for sre-agent → remediation-agent.
                  Go to <span className="text-violet-400">/control-plane</span> and add an agent-to-agent allow policy, then re-run.
                </p>
              </div>
            )}

            {/* Plan — streaming or complete */}
            {opaAllowed && result.status === 'streaming' && (
              <StreamingView raw_text={result.raw_text ?? ''} />
            )}
            {opaAllowed && result.status !== 'streaming' && (result.plan?.steps?.length > 0 || result.plan?.summary) && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-4 h-4 text-orange-400" />
                  <h2 className="text-sm font-semibold text-white">Remediation Plan</h2>
                  <span className="text-[10px] font-mono text-gray-600 ml-auto">
                    {(result.plan.steps ?? []).filter(s => s.risk === 'DESTRUCTIVE').length} destructive /
                    {' '}{(result.plan.steps ?? []).filter(s => s.risk === 'SAFE').length} safe
                  </span>
                </div>
                <PlanView plan={result.plan} />
              </div>
            )}

            {/* SRE findings (collapsible feel) */}
            {result.findings && (
              <details className="bg-gray-900 rounded-xl border border-gray-800">
                <summary className="px-4 py-3 text-xs text-gray-500 cursor-pointer hover:text-gray-300 font-mono select-none">
                  SRE Agent findings (passed to remediation-agent)
                </summary>
                <pre className="px-4 pb-4 text-[11px] text-gray-500 whitespace-pre-wrap leading-relaxed font-mono border-t border-gray-800 pt-3">
                  {result.findings}
                </pre>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  )
}
