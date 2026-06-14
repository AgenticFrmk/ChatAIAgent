import { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Shield, CheckCircle, XCircle, Loader2, Terminal,
  AlertTriangle, Lock, Unlock, ArrowRight,
} from 'lucide-react'
import { useSession } from '../hooks/useSession'

const GATEWAY  = (import.meta.env.VITE_GATEWAY_URL  as string | undefined) ?? '/gateway'
const CONTROL  = '/control'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string; ts: string; allowed: boolean
  caller: string; target: string; reason: string
}

type PanelStatus = 'idle' | 'running' | 'allowed' | 'denied' | 'done'

interface AgentPanel {
  status: PanelStatus; content: string; label: string
  plan?: RemPlan | null; nodeLog?: string[]
}

interface RemStep {
  order: number; action: string; command: string
  risk: 'SAFE' | 'DESTRUCTIVE'; reason: string
}
interface RemPlan { summary: string; steps: RemStep[] }

interface ChainEvent {
  type: string; step?: string; from_agent?: string; to_agent?: string
  opa?: string; reason?: string; content?: string; detail?: string
  plan?: RemPlan; destructive_count?: number
  node?: string; label?: string; log?: string[]; nodes_executed?: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowTs() {
  const now = new Date()
  const t = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${t}.${String(now.getMilliseconds()).padStart(3, '0')}`
}
function makeId() { return Math.random().toString(36).slice(2) }

async function* readSSE(response: Response): AsyncGenerator<ChainEvent> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { yield JSON.parse(line.slice(6)) } catch { /* skip */ }
      }
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function DecisionBadge({ opa }: { opa: 'ALLOW' | 'DENY' | null }) {
  if (!opa) return null
  return opa === 'ALLOW' ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-300 border border-emerald-700">
      <CheckCircle className="w-3 h-3" /> ALLOW
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-red-900/60 text-red-300 border border-red-700">
      <XCircle className="w-3 h-3" /> DENY
    </span>
  )
}

function PlanView({ plan }: { plan: RemPlan }) {
  const destructive = plan.steps.filter(s => s.risk === 'DESTRUCTIVE')
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-300 italic mb-2">{plan.summary}</p>
      {destructive.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-orange-400 bg-orange-950/40 border border-orange-800/50 rounded px-2 py-1 mb-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0" />
          <span>{destructive.length} destructive op{destructive.length > 1 ? 's' : ''} — zero-trust enforced by OPA</span>
        </div>
      )}
      {plan.steps.map(s => (
        <div key={s.order} className={`rounded border px-2.5 py-2 ${s.risk === 'DESTRUCTIVE' ? 'bg-red-950/30 border-red-800/50' : 'bg-gray-800/50 border-gray-700/50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-gray-500">#{s.order}</span>
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${s.risk === 'DESTRUCTIVE' ? 'bg-red-900/60 text-red-300 border border-red-700' : 'bg-emerald-900/40 text-emerald-400 border border-emerald-800'}`}>
              {s.risk}
            </span>
            <span className="text-[11px] text-gray-200 font-medium">{s.action}</span>
          </div>
          <code className={`block text-[10px] font-mono px-2 py-1 rounded mb-1 ${s.risk === 'DESTRUCTIVE' ? 'bg-red-900/30 text-red-200' : 'bg-gray-900 text-gray-300'}`}>
            {s.command}
          </code>
          <p className="text-[10px] text-gray-500">{s.reason}</p>
        </div>
      ))}
    </div>
  )
}

function AgentCard({ name, port, agentType, panel, active }: {
  name: string; port: number; agentType: 'sre' | 'remediation'
  panel: AgentPanel; active: boolean
}) {
  const ringColor =
    panel.status === 'denied'  ? 'ring-red-500/50 border-red-500/30' :
    panel.status === 'done' || panel.status === 'allowed' ? 'ring-emerald-500/50 border-emerald-500/30' :
    active ? 'ring-violet-500/50 border-violet-500/30' : 'ring-transparent border-gray-700'

  const accent = agentType === 'sre' ? 'from-violet-600 to-purple-700' : 'from-orange-600 to-red-700'

  return (
    <div className={`flex flex-col bg-gray-900 rounded-xl border ring-1 ${ringColor} overflow-hidden transition-all duration-300 h-full`}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950/50 flex-shrink-0">
        <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${accent} flex items-center justify-center flex-shrink-0`}>
          {agentType === 'remediation' ? <AlertTriangle className="w-3.5 h-3.5 text-white" /> : <Terminal className="w-3.5 h-3.5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-[10px] text-gray-500 font-mono">:{port}</p>
        </div>
        {panel.status === 'running' && <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />}
        {(panel.status === 'allowed' || panel.status === 'done') && <CheckCircle className="w-4 h-4 text-emerald-400" />}
        {panel.status === 'denied' && <XCircle className="w-4 h-4 text-red-400" />}
      </div>
      <div className="flex-1 p-4 overflow-y-auto min-h-0">
        {panel.status === 'idle' && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-gray-600 italic">{panel.label}</p>
          </div>
        )}
        {panel.status === 'running' && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              <span>{panel.nodeLog?.length ? 'Running LangGraph…' : 'Processing…'}</span>
            </div>
            {panel.nodeLog?.map((entry, i) => (
              <div key={i} className="flex items-center gap-2 font-mono text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === (panel.nodeLog!.length - 1) ? 'bg-violet-400 animate-pulse' : 'bg-emerald-600'}`} />
                <span className={i === (panel.nodeLog!.length - 1) ? 'text-violet-300' : 'text-gray-500'}>{entry}</span>
              </div>
            ))}
          </div>
        )}
        {panel.status === 'denied' && (
          <div className="rounded-lg bg-red-950/40 border border-red-800/50 p-3">
            <p className="text-xs font-bold text-red-300 mb-1 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" /> OPA DENIED
            </p>
            <p className="text-xs text-red-400">
              Access blocked — chain rule is <strong>disabled</strong> or <code className="bg-red-900/50 px-1 rounded">x-calling-agent</code> not present.
            </p>
            <p className="text-[10px] text-red-600 mt-1">Enable the chain rule in the Policy Gate to allow this call.</p>
          </div>
        )}
        {(panel.status === 'allowed' || panel.status === 'done') && (
          panel.plan ? <PlanView plan={panel.plan} /> :
          panel.content ? (
            <div className="rounded-lg bg-gray-800/60 border border-gray-700/50 p-3">
              <pre className="text-xs text-gray-200 whitespace-pre-wrap leading-relaxed">{panel.content}</pre>
            </div>
          ) : null
        )}
      </div>
    </div>
  )
}

// ── Policy Gate — center column ───────────────────────────────────────────────

function PolicyGate({ chainEnabled, loading, onToggle }: {
  chainEnabled: boolean; loading: boolean; onToggle: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-2">

      {/* Vertical connector top */}
      <div className="flex-1 w-px bg-gray-800" />

      {/* Gate card */}
      <div className={`rounded-xl border p-4 flex flex-col items-center gap-3 transition-all duration-500 w-36 ${
        chainEnabled
          ? 'bg-emerald-950/30 border-emerald-800/60 shadow-emerald-900/20 shadow-lg'
          : 'bg-red-950/30 border-red-800/60 shadow-red-900/20 shadow-lg'
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-500 ${
          chainEnabled ? 'bg-emerald-900/60' : 'bg-red-900/60'
        }`}>
          {chainEnabled
            ? <Unlock className="w-5 h-5 text-emerald-400" />
            : <Lock className="w-5 h-5 text-red-400" />
          }
        </div>

        <div className="text-center">
          <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mb-1">Policy Gate</p>
          <p className={`text-xs font-bold ${chainEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
            {chainEnabled ? 'ALLOW' : 'DENY'}
          </p>
          <p className="text-[9px] text-gray-600 mt-0.5">chain rule</p>
        </div>

        {/* Toggle */}
        <button
          onClick={onToggle}
          disabled={loading}
          className={`relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none disabled:opacity-50 ${
            chainEnabled ? 'bg-emerald-600' : 'bg-gray-700'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
            chainEnabled ? 'translate-x-6' : 'translate-x-0.5'
          }`} />
        </button>

        <p className="text-[9px] text-gray-600 text-center leading-tight">
          {chainEnabled ? 'Click to deny' : 'Click to allow'}
        </p>
      </div>

      {/* Arrow */}
      <div className={`flex flex-col items-center gap-1 transition-colors duration-500 ${
        chainEnabled ? 'text-emerald-500' : 'text-red-500'
      }`}>
        <ArrowRight className="w-5 h-5" />
      </div>

      {/* Vertical connector bottom */}
      <div className="flex-1 w-px bg-gray-800" />
    </div>
  )
}

// ── Data plane log ────────────────────────────────────────────────────────────

function DataPlaneLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div className="bg-gray-950 border-t border-gray-800 flex-shrink-0">
      <div className="flex items-center gap-2 px-4 pt-2 pb-1">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Data Plane — Envoy + OPA decisions</span>
      </div>
      <div className="h-24 overflow-y-auto px-4 pb-2 space-y-0.5">
        {entries.length === 0 && <p className="text-[11px] text-gray-700 italic pt-1">Run a scenario to see live OPA decisions…</p>}
        {entries.map(e => (
          <div key={e.id} className="flex items-center gap-3 font-mono text-[11px]">
            <span className="text-gray-600 flex-shrink-0">{e.ts}</span>
            <span className={`flex-shrink-0 font-bold w-16 ${e.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
              {e.allowed ? '✅ ALLOW' : '🚫  DENY'}
            </span>
            <span className="text-gray-300 flex-shrink-0">{e.caller}</span>
            <span className="text-gray-600 flex-shrink-0">→</span>
            <span className="text-gray-300 flex-shrink-0">{e.target}</span>
            <span className="text-gray-600 truncate">{e.reason}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Scenario button ───────────────────────────────────────────────────────────

function ScenarioButton({ number, label, sublabel, variant, disabled, onClick }: {
  number: string; label: string; sublabel: string
  variant: 'neutral' | 'deny' | 'allow'; disabled: boolean; onClick: () => void
}) {
  const colors = {
    neutral: 'bg-violet-600 hover:bg-violet-500 border-violet-500 disabled:bg-gray-700 disabled:border-gray-600 disabled:text-gray-500',
    deny:    'bg-red-700   hover:bg-red-600   border-red-600   disabled:bg-gray-700 disabled:border-gray-600 disabled:text-gray-500',
    allow:   'bg-emerald-700 hover:bg-emerald-600 border-emerald-600 disabled:bg-gray-700 disabled:border-gray-600 disabled:text-gray-500',
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex flex-col items-start gap-0.5 px-4 py-2.5 rounded-lg border text-left text-white transition-colors disabled:cursor-not-allowed ${colors[variant]}`}>
      <span className="text-[10px] opacity-60 font-mono">Scenario {number}</span>
      <span className="text-sm font-semibold leading-tight">{label}</span>
      <span className="text-[10px] opacity-70">{sublabel}</span>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DemoPage() {
  const navigate  = useNavigate()
  const { session } = useSession()

  const [sre,         setSre]         = useState<AgentPanel>({ status: 'idle', content: '', label: 'Waiting for a scenario…' })
  const [remediation, setRemediation] = useState<AgentPanel>({ status: 'idle', content: '', label: 'Blocked by Policy Gate', plan: null })
  const [log,         setLog]         = useState<LogEntry[]>([])
  const [busy,        setBusy]        = useState(false)
  const [chainEnabled,    setChainEnabled]    = useState(false)
  const [policyLoading,   setPolicyLoading]   = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Fetch current policy state on mount
  useEffect(() => {
    fetch(`${CONTROL}/policy/chain-rule`)
      .then(r => r.json())
      .then(d => setChainEnabled(d.chain_enabled ?? false))
      .catch(() => {})
  }, [])

  const addLog = useCallback((entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLog(prev => [{ ...entry, id: makeId(), ts: nowTs() }, ...prev])
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setSre({ status: 'idle', content: '', label: 'Waiting for a scenario…' })
    setRemediation({ status: 'idle', content: '', label: 'Blocked by Policy Gate', plan: null })
    setLog([])
    setBusy(false)
  }, [])

  const handlePolicyToggle = useCallback(async () => {
    setPolicyLoading(true)
    try {
      const next = !chainEnabled
      const r = await fetch(`${CONTROL}/policy/chain-rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      const d = await r.json()
      setChainEnabled(d.chain_enabled)
    } catch { /* ignore */ }
    finally { setPolicyLoading(false) }
  }, [chainEnabled])

  // ── Scenario 1: Ask SRE Agent ────────────────────────────────────────────
  const handleAskSRE = useCallback(async () => {
    if (!session) return navigate('/login')
    reset(); setBusy(true)
    setSre(p => ({ ...p, status: 'running' }))
    try {
      const ac = new AbortController(); abortRef.current = ac
      const res = await fetch(`${GATEWAY}/sre/graph/ping/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ message: 'status check' }), signal: ac.signal,
      })
      if (!res.ok) { addLog({ allowed: false, caller: 'user', target: 'sre-agent', reason: `HTTP ${res.status}` }); setSre(p => ({ ...p, status: 'denied' })); return }
      addLog({ allowed: true, caller: 'user', target: 'sre-agent', reason: 'JWT valid · sre-agent is primary entry point' })
      for await (const ev of readSSE(res)) {
        if (ev.type === 'done') break
        if (ev.step === 'sre_response') setSre({ status: 'done', content: ev.content ?? '', label: '' })
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') setSre(p => ({ ...p, status: 'denied' }))
    } finally { setBusy(false) }
  }, [session, navigate, reset, addLog])

  // ── Scenario 2: Direct Remediation → DENY ───────────────────────────────
  const handleDirectRemediation = useCallback(async () => {
    if (!session) return navigate('/login')
    reset(); setBusy(true)
    setRemediation(p => ({ ...p, status: 'running' }))
    try {
      const ac = new AbortController(); abortRef.current = ac
      const res = await fetch(`${GATEWAY}/remediation/graph/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ message: 'execute remediation', thread_id: '' }), signal: ac.signal,
      })
      if (res.status === 403) {
        addLog({ allowed: false, caller: 'user', target: 'remediation-agent', reason: 'no x-calling-agent · zero-trust chain rule violated' })
        setRemediation(p => ({ ...p, status: 'denied' }))
      } else {
        addLog({ allowed: true, caller: 'user', target: 'remediation-agent', reason: `HTTP ${res.status} — unexpected allow` })
        const body = await res.json()
        setRemediation({ status: 'done', content: '', label: '', plan: body.plan ?? null })
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setRemediation(p => ({ ...p, status: 'denied' }))
        addLog({ allowed: false, caller: 'user', target: 'remediation-agent', reason: 'request failed' })
      }
    } finally { setBusy(false) }
  }, [session, navigate, reset, addLog])

  // ── Scenario 3: Real SRE graph → Remediation Chain ──────────────────────
  const handleChain = useCallback(async () => {
    if (!session) return navigate('/login')
    reset(); setBusy(true)
    try {
      const ac = new AbortController(); abortRef.current = ac
      const res = await fetch(`${GATEWAY}/sre/graph/chain/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        // Real VPN incident — runs actual LangGraph graph with real tool calls
        body: JSON.stringify({
          message: 'Our VPN tunnels to Boston and Chicago keep dropping. Phase 2 is renegotiating repeatedly — it used to be stable. Investigate and produce a remediation plan.',
          thread_id: `chain-${makeId()}`,
        }),
        signal: ac.signal,
      })
      if (!res.ok) {
        addLog({ allowed: false, caller: 'user', target: 'sre-agent', reason: `HTTP ${res.status}` })
        setSre(p => ({ ...p, status: 'denied' })); setBusy(false); return
      }
      for await (const ev of readSSE(res)) {
        if (ev.type === 'done') break

        if (ev.step === 'sre_start') {
          setSre(p => ({ ...p, status: 'running', nodeLog: [] }))
          addLog({ allowed: ev.opa === 'ALLOW', caller: ev.from_agent ?? 'user', target: ev.to_agent ?? 'sre-agent', reason: ev.reason ?? '' })
        }

        // Real LangGraph nodes streaming in real-time
        if (ev.step === 'sre_node') {
          setSre(p => ({ ...p, status: 'running', nodeLog: ev.log ?? p.nodeLog }))
        }

        if (ev.step === 'sre_findings') {
          setSre({ status: 'allowed', content: ev.content ?? '', label: '', nodeLog: undefined })
          addLog({ allowed: true, caller: 'sre-agent', target: 'sre-agent', reason: `${ev.nodes_executed ?? '?'} nodes executed · real tool calls` })
        }

        if (ev.step === 'obo_issued') {
          addLog({ allowed: true, caller: 'sre-agent', target: 'auth-service', reason: ev.detail ?? 'OBO token issued' })
        }

        if (ev.step === 'chain_request') {
          setRemediation(p => ({ ...p, status: 'running' }))
        }

        if (ev.step === 'remediation_response') {
          addLog({ allowed: ev.opa === 'ALLOW', caller: ev.from_agent ?? 'sre-agent', target: ev.to_agent ?? 'remediation-agent', reason: ev.reason ?? '' })
          setRemediation({ status: 'done', content: '', label: '', plan: ev.plan ?? null })
        }

        if (ev.step === 'opa_deny') {
          addLog({ allowed: false, caller: ev.from_agent ?? 'sre-agent', target: ev.to_agent ?? 'remediation-agent', reason: ev.reason ?? 'chain rule disabled' })
          setRemediation(p => ({ ...p, status: 'denied' }))
        }

        if (ev.step === 'error') {
          setRemediation(p => ({ ...p, status: 'denied', content: ev.detail ?? 'Error' }))
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') setSre(p => ({ ...p, status: 'denied' }))
    } finally { setBusy(false) }
  }, [session, navigate, reset, addLog])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">

      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-purple-700 flex items-center justify-center">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">Zero-Trust Agent Chain Demo</h1>
          <p className="text-[10px] text-gray-500">Envoy + OPA data-plane · live policy control via AgentControlPlane</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono">
            <span className="flex items-center gap-1 text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> OPA ext_authz</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" /> Envoy proxy</span>
            <span className="flex items-center gap-1 text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-sky-400 inline-block" /> Consul · AgentControlPlane</span>
          </div>
          {busy && <button onClick={reset} className="text-[11px] text-gray-400 hover:text-white border border-gray-700 rounded px-2 py-1">Reset</button>}
          <button onClick={() => navigate('/chat')} className="text-[11px] text-gray-500 hover:text-white">← Chat</button>
        </div>
      </header>

      {/* 3-column agent layout */}
      <div className="flex-1 grid grid-cols-[1fr_152px_1fr] gap-3 p-3 overflow-hidden min-h-0">
        <AgentCard name="SRE Agent (A)" port={8080} agentType="sre"
          panel={sre} active={busy && sre.status === 'running'} />

        <PolicyGate chainEnabled={chainEnabled} loading={policyLoading} onToggle={handlePolicyToggle} />

        <AgentCard name="Remediation Agent (B)" port={8085} agentType="remediation"
          panel={remediation} active={busy && remediation.status === 'running'} />
      </div>

      {/* Data plane log */}
      <DataPlaneLog entries={log} />

      {/* Scenario buttons */}
      <div className="flex-shrink-0 border-t border-gray-800 bg-gray-900 px-4 py-3 flex gap-3 flex-wrap">
        <ScenarioButton number="1" label="Ask SRE Agent"
          sublabel="user → sre-agent · ALLOW" variant="neutral" disabled={busy} onClick={handleAskSRE} />
        <ScenarioButton number="2" label="Direct Remediation"
          sublabel="user → remediation-agent · DENY (no chain header)" variant="deny" disabled={busy} onClick={handleDirectRemediation} />
        <ScenarioButton number="3" label="VPN Tunnel Alert → Chain"
          sublabel={chainEnabled ? "Real graph · real tools · OBO token · ALLOW" : "Real graph · real tools · OBO token · DENY"} variant="allow" disabled={busy} onClick={handleChain} />
      </div>
    </div>
  )
}
