import { useState, useEffect, useCallback } from 'react'
import { Shield, CheckCircle, XCircle, RefreshCw, Zap, Server } from 'lucide-react'

const CONTROL = '/control'

interface ChainRule { chain_enabled: boolean }
interface Clusters  { version: string | null; clusters: string[] }

export default function PolicyPage() {
  const [rule,     setRule]     = useState<ChainRule | null>(null)
  const [clusters, setClusters] = useState<Clusters | null>(null)
  const [toggling, setToggling] = useState(false)
  const [lastSync, setLastSync] = useState('')

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([
        fetch(`${CONTROL}/policy/chain-rule`).then(x => x.json()),
        fetch(`${CONTROL}/clusters`).then(x => x.json()),
      ])
      setRule(r)
      setClusters(c)
      setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }))
    } catch { /* keep previous */ }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async () => {
    if (!rule || toggling) return
    setToggling(true)
    try {
      const res = await fetch(`${CONTROL}/policy/chain-rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.chain_enabled }),
      })
      const updated = await res.json()
      setRule(updated)
    } finally {
      setToggling(false)
    }
  }

  const allowed = rule?.chain_enabled === true

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">Agent Control Plane</h1>
          <p className="text-[10px] text-gray-500 font-mono">Envoy · OPA · live policy — no restart required</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] font-mono text-gray-600">
            synced {lastSync || '—'}
          </span>
          <button
            onClick={load}
            className="p-1.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-2xl w-full mx-auto px-5 py-6 space-y-6">

        {/* Agent Chaining Policy */}
        <section>
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-3">
            Agent Chaining Rules
          </h2>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            {/* Rule row */}
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-violet-400 font-mono">sre-agent</span>
                  <span className="text-gray-600 text-xs">→</span>
                  <span className="text-sm font-semibold text-orange-400 font-mono">remediation-agent</span>
                </div>
                <p className="text-[11px] text-gray-500">
                  OAuth 2.0 On-Behalf-Of chain (RFC 8693) · verified by Envoy jwt_authn · enforced by OPA ext_authz
                </p>
              </div>

              {/* Toggle */}
              <button
                onClick={toggle}
                disabled={toggling || rule === null}
                className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono font-bold border transition-all ${
                  allowed
                    ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300 hover:bg-emerald-900/80'
                    : 'bg-red-900/50 border-red-800 text-red-300 hover:bg-red-900/80'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {toggling ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : allowed ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                {allowed ? 'ALLOW' : 'DENY'}
              </button>
            </div>

            {/* OPA data path */}
            <div className="mt-4 bg-gray-950 rounded-lg border border-gray-800 px-3 py-2 font-mono text-[10px] space-y-1">
              <div className="flex gap-2">
                <span className="text-gray-600 w-28">OPA data path</span>
                <span className="text-violet-400">data.routing.chain_enabled</span>
                <span className={`ml-auto font-bold ${allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  = {rule === null ? '…' : String(rule.chain_enabled)}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-600 w-28">OPA rule</span>
                <span className="text-gray-400">caller == "sre-agent" ∧ target == "remediation-agent" ∧ chain_enabled</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-600 w-28">header proof</span>
                <span className="text-gray-400">x-calling-agent injected by Envoy from OBO JWT · cannot be forged</span>
              </div>
            </div>

            {/* Behaviour description */}
            <p className="mt-3 text-[11px] text-gray-600 leading-relaxed">
              {allowed
                ? 'Chain ALLOWED — when sre-agent approves a remediation plan it exchanges the user JWT for an OBO token (act.sub = sre-agent, aud = remediation-agent) and calls Envoy. OPA verifies the chain rule and forwards to remediation-agent.'
                : 'Chain DENIED — Envoy will return 403 when sre-agent attempts to call remediation-agent. The OBO token is issued by AuthService but OPA blocks the forwarding at ext_authz. Toggle to ALLOW to enable the chain.'}
            </p>
          </div>
        </section>

        {/* Registered Clusters */}
        <section>
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-3">
            Live Clusters — Consul → Envoy CDS
          </h2>
          <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
            {clusters === null ? (
              <div className="px-4 py-3 text-xs text-gray-600 font-mono">loading…</div>
            ) : clusters.clusters.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-600 font-mono">no clusters registered</div>
            ) : clusters.clusters.map(name => {
              const isAgent = name.includes('agent')
              return (
                <div key={name} className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isAgent ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                  <span className="text-xs font-mono text-gray-300">{name}</span>
                  {isAgent && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-gray-600">
                      <Server className="w-3 h-3" /> Consul-registered · CDS hot-reload
                    </span>
                  )}
                </div>
              )
            })}
            {clusters?.version && (
              <div className="px-4 py-2 flex items-center gap-2 text-[10px] font-mono text-gray-700">
                <Zap className="w-3 h-3" />
                CDS version {clusters.version}
              </div>
            )}
          </div>
        </section>

        {/* Zero-trust summary */}
        <section className="bg-gray-900/50 rounded-xl border border-gray-800 px-4 py-4">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">Zero-Trust Chain Properties</h2>
          <div className="space-y-2 text-[11px] font-mono">
            {[
              ['Caller identity',  'x-calling-agent injected by Envoy jwt_authn from OBO JWT claim — not client-supplied'],
              ['Forgery protection', 'Global header_mutation strips x-calling-agent before jwt_authn runs'],
              ['Token TTL',        'OBO token expires in 5 min (iat + exp in JWT payload)'],
              ['Policy update',    'PUT /policy/chain-rule hits OPA data API — effective immediately, no Envoy restart'],
              ['Audit trail',      'OPA decision_logs → stdout · Envoy access log → stdout'],
            ].map(([label, val]) => (
              <div key={label} className="flex gap-3">
                <span className="text-gray-600 w-36 flex-shrink-0">{label}</span>
                <span className="text-gray-400">{val}</span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  )
}
