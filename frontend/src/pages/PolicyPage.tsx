import { useState, useEffect, useCallback } from 'react'
import {
  Shield, RefreshCw, Plus, Trash2, Edit2, Check, X,
  Server, Wrench, Users, Lock, ChevronDown, ChevronUp,
  Activity, Zap, Play,
} from 'lucide-react'

const API = '/control'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agent {
  agent_id: string; name: string; fqdn: string
  capabilities: string[]; owner: string; status: 'live' | 'offline'
  registration: string; last_heartbeat: number; created_at: number
}

interface ToolAction {
  path?: string; method?: string
  grpc_service?: string; grpc_method?: string
  database?: string; table?: string; operation?: string
  topic?: string; default_policy: string
}

interface Tool {
  tool_id: string; name: string; fqdn: string
  protocol: string; actions: ToolAction[]; owner: string; source: string
}

interface PolicyActionData {
  path?: string; method?: string
  grpc_service?: string; grpc_method?: string
  database?: string; table?: string; operation?: string
  topic?: string
}

interface Policy {
  policy_id: string; domain: string
  subject_type: string; subject_id: string
  resource_type: string; resource_fqdn: string
  protocol?: string; action?: PolicyActionData; effect: string
}

interface Group {
  group_id: string; name: string; members: string[]
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`${r.status} ${text}`)
  }
  if (r.status === 204) return undefined as T
  return r.json()
}

// ── Small UI helpers ──────────────────────────────────────────────────────────

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${color}`}>
      {text}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${status === 'live' ? 'bg-emerald-400' : 'bg-gray-600'}`} />
  )
}

function EmptyRow({ cols, msg }: { cols: number; msg: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-6 text-center text-xs text-gray-600 font-mono">{msg}</td>
    </tr>
  )
}

function Btn({
  onClick, disabled, variant = 'ghost', children, title,
}: {
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean
  variant?: 'ghost' | 'primary' | 'danger' | 'success'
  children: React.ReactNode; title?: string
}) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const v = {
    ghost:   'text-gray-400 hover:text-white hover:bg-gray-800',
    primary: 'bg-violet-700 hover:bg-violet-600 text-white',
    danger:  'text-red-400 hover:text-red-300 hover:bg-red-900/30',
    success: 'bg-emerald-800 hover:bg-emerald-700 text-emerald-200',
  }[variant]
  return (
    <button className={`${base} ${v}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  )
}

function Input({
  value, onChange, placeholder, className = '',
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500 ${className}`}
    />
  )
}

function Select({
  value, onChange, options, className = '',
}: {
  value: string; onChange: (v: string) => void; options: string[]; className?: string
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-violet-500 ${className}`}
    >
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-3">{label}</h2>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">{children}</div>
  )
}

function Table({ heads, children }: { heads: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-xs font-mono">
      <thead>
        <tr className="border-b border-gray-800">
          {heads.map(h => (
            <th key={h} className="px-4 py-2 text-left text-[10px] text-gray-600 uppercase tracking-wider font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-800/60">{children}</tbody>
    </table>
  )
}

// ── Agents Tab ────────────────────────────────────────────────────────────────

function AgentsTab() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', fqdn: '', owner: '', capabilities: '', description: '', registration: 'manual' })
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ agents: Agent[] }>('/agents')
      setAgents(data.agents)
    } catch { /* keep previous */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const payload = {
        name: form.name, fqdn: form.fqdn, owner: form.owner,
        description: form.description, registration: form.registration,
        capabilities: form.capabilities.split(',').map(s => s.trim()).filter(Boolean),
      }
      if (editId) {
        await apiFetch(`/agents/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/agents/register', { method: 'POST', body: JSON.stringify(payload) })
      }
      setShowForm(false); setEditId(null)
      setForm({ name: '', fqdn: '', owner: '', capabilities: '', description: '', registration: 'manual' })
      load()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  const del = async (id: string) => {
    if (!confirm('Delete agent?')) return
    await apiFetch(`/agents/${id}`, { method: 'DELETE' })
    load()
  }

  const startEdit = (a: Agent) => {
    setForm({ name: a.name, fqdn: a.fqdn, owner: a.owner, capabilities: a.capabilities.join(', '), description: '', registration: a.registration })
    setEditId(a.agent_id); setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader label="Registered Agents" />
        <div className="flex gap-2">
          <Btn onClick={load} variant="ghost"><RefreshCw className="w-3 h-3" /></Btn>
          <Btn onClick={() => { setShowForm(s => !s); setEditId(null) }} variant="primary">
            <Plus className="w-3 h-3" /> Register Agent
          </Btn>
        </div>
      </div>

      {showForm && (
        <Card>
          <div className="p-4 space-y-3">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
              {editId ? 'Edit Agent' : 'Register Agent'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Name</label>
                <Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="sre-agent" className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">FQDN</label>
                <Input value={form.fqdn} onChange={v => setForm(f => ({ ...f, fqdn: v }))} placeholder="sre-agent.agents.internal" className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Owner</label>
                <Input value={form.owner} onChange={v => setForm(f => ({ ...f, owner: v }))} placeholder="platform-team" className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Registration</label>
                <Select value={form.registration} onChange={v => setForm(f => ({ ...f, registration: v }))} options={['manual', 'self']} className="w-full" />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-[10px] text-gray-600">Capabilities (comma-separated)</label>
                <Input value={form.capabilities} onChange={v => setForm(f => ({ ...f, capabilities: v }))} placeholder="diagnose, remediate, escalate" className="w-full" />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Btn onClick={() => { setShowForm(false); setEditId(null) }} variant="ghost"><X className="w-3 h-3" /> Cancel</Btn>
              <Btn onClick={save} disabled={saving || !form.name || !form.fqdn} variant="primary">
                <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save Agent'}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <Table heads={['Name / FQDN', 'Capabilities', 'Owner', 'Status', 'Reg', '']}>
          {loading ? (
            <EmptyRow cols={6} msg="loading…" />
          ) : agents.length === 0 ? (
            <EmptyRow cols={6} msg="No agents registered" />
          ) : agents.map(a => (
            <tr key={a.agent_id} className="hover:bg-gray-800/30">
              <td className="px-4 py-2.5">
                <div className="text-gray-200 font-semibold">{a.name}</div>
                <div className="text-gray-600 text-[10px]">{a.fqdn}</div>
              </td>
              <td className="px-4 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {a.capabilities.map(c => (
                    <Badge key={c} text={c} color="bg-violet-900/50 text-violet-300" />
                  ))}
                </div>
              </td>
              <td className="px-4 py-2.5 text-gray-500">{a.owner || '—'}</td>
              <td className="px-4 py-2.5">
                <StatusDot status={a.status} />
                <span className={a.status === 'live' ? 'text-emerald-400' : 'text-gray-600'}>{a.status}</span>
              </td>
              <td className="px-4 py-2.5 text-gray-600">{a.registration}</td>
              <td className="px-4 py-2.5">
                <div className="flex gap-1 justify-end">
                  <Btn onClick={() => startEdit(a)} variant="ghost" title="Edit"><Edit2 className="w-3 h-3" /></Btn>
                  <Btn onClick={() => del(a.agent_id)} variant="danger" title="Delete"><Trash2 className="w-3 h-3" /></Btn>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ── Tools Tab ─────────────────────────────────────────────────────────────────

const PROTOCOLS = ['https', 'grpc', 'postgresql', 'kafka', 'mcp']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const DB_OPS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE']
const KAFKA_OPS = ['PRODUCE', 'CONSUME']

function ToolsTab() {
  const [tools, setTools] = useState<Tool[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', fqdn: '', protocol: 'https', owner: '', source: 'manual' })
  const [actions, setActions] = useState<ToolAction[]>([])
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ tools: Tool[] }>('/tools')
      setTools(data.tools)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const addAction = () => setActions(a => [...a, { default_policy: 'deny' }])
  const removeAction = (i: number) => setActions(a => a.filter((_, idx) => idx !== i))
  const updateAction = (i: number, patch: Partial<ToolAction>) =>
    setActions(a => a.map((act, idx) => idx === i ? { ...act, ...patch } : act))

  const save = async () => {
    setSaving(true)
    try {
      const payload = { ...form, actions }
      if (editId) {
        await apiFetch(`/tools/${editId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await apiFetch('/tools/register', { method: 'POST', body: JSON.stringify(payload) })
      }
      setShowForm(false); setEditId(null); setActions([])
      setForm({ name: '', fqdn: '', protocol: 'https', owner: '', source: 'manual' })
      load()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  const del = async (id: string) => {
    if (!confirm('Delete tool?')) return
    await apiFetch(`/tools/${id}`, { method: 'DELETE' })
    load()
  }

  const startEdit = (t: Tool) => {
    setForm({ name: t.name, fqdn: t.fqdn, protocol: t.protocol, owner: t.owner, source: t.source })
    setActions(t.actions); setEditId(t.tool_id); setShowForm(true)
  }

  const protoColor: Record<string, string> = {
    https: 'bg-blue-900/50 text-blue-300',
    grpc:  'bg-orange-900/50 text-orange-300',
    postgresql: 'bg-teal-900/50 text-teal-300',
    kafka: 'bg-yellow-900/50 text-yellow-300',
    mcp:   'bg-purple-900/50 text-purple-300',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader label="Registered Tools" />
        <div className="flex gap-2">
          <Btn onClick={load} variant="ghost"><RefreshCw className="w-3 h-3" /></Btn>
          <Btn onClick={() => { setShowForm(s => !s); setEditId(null); setActions([]) }} variant="primary">
            <Plus className="w-3 h-3" /> Register Tool
          </Btn>
        </div>
      </div>

      {showForm && (
        <Card>
          <div className="p-4 space-y-4">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
              {editId ? 'Edit Tool' : 'Register Tool'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Name</label>
                <Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="search-confluence" className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">FQDN</label>
                <Input value={form.fqdn} onChange={v => setForm(f => ({ ...f, fqdn: v }))} placeholder="search-confluence.tools.internal" className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Protocol</label>
                <Select value={form.protocol} onChange={v => setForm(f => ({ ...f, protocol: v }))} options={PROTOCOLS} className="w-full" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Owner</label>
                <Input value={form.owner} onChange={v => setForm(f => ({ ...f, owner: v }))} placeholder="platform-team" className="w-full" />
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] text-gray-600 uppercase tracking-widest">Actions</label>
                <Btn onClick={addAction} variant="ghost"><Plus className="w-3 h-3" /> Add Action</Btn>
              </div>
              {actions.map((act, i) => (
                <div key={i} className="bg-gray-950 rounded-lg border border-gray-800 p-3 flex gap-2 items-end flex-wrap">
                  {(form.protocol === 'https' || form.protocol === 'mcp') && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Path</label>
                      <Input value={act.path || ''} onChange={v => updateAction(i, { path: v })} placeholder="/search" className="w-28" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Method</label>
                      <Select value={act.method || 'GET'} onChange={v => updateAction(i, { method: v })} options={HTTP_METHODS} className="w-20" />
                    </div>
                  </>}
                  {form.protocol === 'grpc' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Service</label>
                      <Input value={act.grpc_service || ''} onChange={v => updateAction(i, { grpc_service: v })} placeholder="SearchService" className="w-32" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Method</label>
                      <Input value={act.grpc_method || ''} onChange={v => updateAction(i, { grpc_method: v })} placeholder="Search" className="w-24" />
                    </div>
                  </>}
                  {form.protocol === 'postgresql' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Database</label>
                      <Input value={act.database || ''} onChange={v => updateAction(i, { database: v })} placeholder="mydb" className="w-24" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Table</label>
                      <Input value={act.table || ''} onChange={v => updateAction(i, { table: v })} placeholder="users" className="w-24" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Operation</label>
                      <Select value={act.operation || 'SELECT'} onChange={v => updateAction(i, { operation: v })} options={DB_OPS} className="w-24" />
                    </div>
                  </>}
                  {form.protocol === 'kafka' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Topic</label>
                      <Input value={act.topic || ''} onChange={v => updateAction(i, { topic: v })} placeholder="alerts-topic" className="w-36" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Operation</label>
                      <Select value={act.operation || 'PRODUCE'} onChange={v => updateAction(i, { operation: v })} options={KAFKA_OPS} className="w-24" />
                    </div>
                  </>}
                  <div className="space-y-1">
                    <label className="text-[10px] text-gray-600">Default</label>
                    <Select value={act.default_policy} onChange={v => updateAction(i, { default_policy: v })} options={['deny', 'allow']} className="w-16" />
                  </div>
                  <Btn onClick={() => removeAction(i)} variant="danger"><Trash2 className="w-3 h-3" /></Btn>
                </div>
              ))}
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Btn onClick={() => { setShowForm(false); setEditId(null) }} variant="ghost"><X className="w-3 h-3" /> Cancel</Btn>
              <Btn onClick={save} disabled={saving || !form.name || !form.fqdn} variant="primary">
                <Check className="w-3 h-3" /> {saving ? 'Saving…' : 'Save Tool'}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <Table heads={['Name / FQDN', 'Protocol', 'Actions', 'Source', '']}>
          {loading ? (
            <EmptyRow cols={5} msg="loading…" />
          ) : tools.length === 0 ? (
            <EmptyRow cols={5} msg="No tools registered" />
          ) : tools.map(t => (
            <>
              <tr key={t.tool_id} className="hover:bg-gray-800/30 cursor-pointer" onClick={() => setExpanded(expanded === t.tool_id ? null : t.tool_id)}>
                <td className="px-4 py-2.5">
                  <div className="text-gray-200 font-semibold">{t.name}</div>
                  <div className="text-gray-600 text-[10px]">{t.fqdn}</div>
                </td>
                <td className="px-4 py-2.5">
                  <Badge text={t.protocol} color={protoColor[t.protocol] || 'bg-gray-800 text-gray-400'} />
                </td>
                <td className="px-4 py-2.5 text-gray-500">{t.actions.length} action{t.actions.length !== 1 ? 's' : ''}</td>
                <td className="px-4 py-2.5 text-gray-600">{t.source}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1 justify-end">
                    {expanded === t.tool_id ? <ChevronUp className="w-3 h-3 text-gray-600" /> : <ChevronDown className="w-3 h-3 text-gray-600" />}
                    <Btn onClick={e => { e.stopPropagation(); startEdit(t) }} variant="ghost" title="Edit"><Edit2 className="w-3 h-3" /></Btn>
                    <Btn onClick={e => { e.stopPropagation(); del(t.tool_id) }} variant="danger" title="Delete"><Trash2 className="w-3 h-3" /></Btn>
                  </div>
                </td>
              </tr>
              {expanded === t.tool_id && t.actions.length > 0 && (
                <tr className="bg-gray-950">
                  <td colSpan={5} className="px-6 py-2">
                    <div className="space-y-1">
                      {t.actions.map((a, i) => (
                        <div key={i} className="flex gap-3 text-[10px] font-mono text-gray-500">
                          <span className="text-gray-400">{a.path || a.grpc_service || a.database || a.topic || '—'}</span>
                          <span className="text-gray-600">{a.method || a.grpc_method || a.operation || '—'}</span>
                          <Badge text={a.default_policy} color={a.default_policy === 'allow' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'} />
                        </div>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ── Policies Tab ──────────────────────────────────────────────────────────────

const DOMAINS = ['user-to-agent', 'agent-to-agent', 'agent-to-tool']

function PoliciesTab() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [activeDomain, setActiveDomain] = useState('user-to-agent')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [simResult, setSimResult] = useState<{ decision: string; matched_policy_id?: string } | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [defaultEgress, setDefaultEgress] = useState<'allow' | 'deny'>('deny')
  const [togglingDefault, setTogglingDefault] = useState(false)

  const [form, setForm] = useState({
    domain: 'user-to-agent', subject_type: 'user', subject_id: '',
    resource_type: 'agent', resource_fqdn: '', protocol: 'https', effect: 'allow',
    path: '', method: 'GET', grpc_service: '', grpc_method: '',
    database: '', table: '', operation: 'SELECT', topic: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ policies: Policy[] }>(`/policies?domain=${activeDomain}`)
      setPolicies(data.policies)
    } catch { }
    finally { setLoading(false) }
  }, [activeDomain])

  useEffect(() => {
    apiFetch<{ effect: string }>('/policy/default-egress')
      .then(r => setDefaultEgress(r.effect as 'allow' | 'deny'))
      .catch(() => {})
  }, [])

  const toggleDefaultEgress = async () => {
    const next = defaultEgress === 'deny' ? 'allow' : 'deny'
    setTogglingDefault(true)
    try {
      await apiFetch('/policy/default-egress', { method: 'PUT', body: JSON.stringify({ effect: next }) })
      setDefaultEgress(next)
    } catch (e: any) { alert(e.message) }
    finally { setTogglingDefault(false) }
  }

  useEffect(() => { load() }, [load])

  const buildAction = () => {
    if (form.domain !== 'agent-to-tool') return undefined
    if (form.protocol === 'https' || form.protocol === 'mcp') return { path: form.path, method: form.method }
    if (form.protocol === 'grpc') return { grpc_service: form.grpc_service, grpc_method: form.grpc_method }
    if (form.protocol === 'postgresql') return { database: form.database, table: form.table, operation: form.operation }
    if (form.protocol === 'kafka') return { topic: form.topic, operation: form.operation }
    return undefined
  }

  const closeForm = () => { setShowForm(false); setEditId(null); setSimResult(null) }

  const save = async () => {
    setSaving(true)
    try {
      if (editId) {
        await apiFetch(`/policies/${editId}`, {
          method: 'PUT',
          body: JSON.stringify({ effect: form.effect, action: buildAction() }),
        })
      } else {
        const payload = {
          domain: form.domain, subject_type: form.subject_type, subject_id: form.subject_id,
          resource_type: form.domain === 'agent-to-tool' ? 'tool' : 'agent',
          resource_fqdn: form.resource_fqdn,
          protocol: form.domain === 'agent-to-tool' ? form.protocol : undefined,
          action: buildAction(), effect: form.effect,
        }
        await apiFetch('/policies', { method: 'POST', body: JSON.stringify(payload) })
      }
      closeForm(); load()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  const startEdit = (p: Policy) => {
    setForm({
      domain: p.domain, subject_type: p.subject_type, subject_id: p.subject_id,
      resource_type: p.resource_type, resource_fqdn: p.resource_fqdn,
      protocol: p.protocol || 'https', effect: p.effect,
      path: p.action?.path || '', method: p.action?.method || 'GET',
      grpc_service: p.action?.grpc_service || '', grpc_method: p.action?.grpc_method || '',
      database: p.action?.database || '', table: p.action?.table || '',
      operation: p.action?.operation || 'SELECT', topic: p.action?.topic || '',
    })
    setEditId(p.policy_id)
    setShowForm(true)
    setSimResult(null)
  }

  const del = async (id: string) => {
    if (!confirm('Delete policy?')) return
    await apiFetch(`/policies/${id}`, { method: 'DELETE' })
    load()
  }

  const simulate = async () => {
    setSimulating(true); setSimResult(null)
    try {
      const payload = {
        subject_type: form.subject_type, subject_id: form.subject_id,
        resource_type: form.domain === 'agent-to-tool' ? 'tool' : 'agent',
        resource_fqdn: form.resource_fqdn,
        protocol: form.domain === 'agent-to-tool' ? form.protocol : undefined,
        action: buildAction(),
      }
      const r = await apiFetch<{ decision: string; matched_policy_id?: string }>('/policies/simulate', { method: 'POST', body: JSON.stringify(payload) })
      setSimResult(r)
    } catch (e: any) { alert(e.message) }
    finally { setSimulating(false) }
  }

  const domainSubjectType: Record<string, string[]> = {
    'user-to-agent':  ['user', 'group'],
    'agent-to-agent': ['agent'],
    'agent-to-tool':  ['agent'],
  }

  return (
    <div className="space-y-4">

      {/* Default egress policy banner */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-gray-800 bg-gray-900/60">
        <div>
          <span className="text-xs font-mono text-gray-400">Default Egress Policy</span>
          <span className="ml-2 text-[10px] text-gray-600">— applies to agent→tool calls when no explicit policy matches</span>
        </div>
        <button
          onClick={toggleDefaultEgress}
          disabled={togglingDefault}
          className="flex items-center gap-2 text-xs font-mono font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 cursor-pointer"
          style={defaultEgress === 'allow'
            ? { background: 'rgb(6 78 59 / 0.4)', borderColor: 'rgb(4 120 87)', color: 'rgb(52 211 153)' }
            : { background: 'rgb(127 29 29 / 0.4)', borderColor: 'rgb(185 28 28)', color: 'rgb(252 165 165)' }
          }
        >
          <span className={`w-2 h-2 rounded-full ${defaultEgress === 'allow' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {togglingDefault ? 'Updating…' : defaultEgress === 'allow' ? 'ALLOW (click to deny)' : 'DENY (click to allow)'}
        </button>
      </div>

      {/* Domain tabs */}
      <div className="flex gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800 w-fit">
        {DOMAINS.map(d => (
          <button
            key={d}
            onClick={() => { setActiveDomain(d); setForm(f => ({ ...f, domain: d, subject_type: d === 'user-to-agent' ? 'user' : 'agent' })) }}
            className={`px-3 py-1.5 rounded text-[11px] font-mono font-semibold transition-colors ${
              activeDomain === d ? 'bg-violet-700 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <SectionHeader label={`${activeDomain} policies`} />
        <div className="flex gap-2">
          <Btn onClick={load} variant="ghost"><RefreshCw className="w-3 h-3" /></Btn>
          <Btn onClick={() => setShowForm(s => !s)} variant="primary"><Plus className="w-3 h-3" /> New Policy</Btn>
        </div>
      </div>

      {showForm && (
        <Card>
          <div className="p-4 space-y-4">
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
              {editId ? `Edit Policy — ${form.domain}` : `New Policy — ${activeDomain}`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Subject Type</label>
                {editId
                  ? <div className="px-2 py-1.5 bg-gray-800/50 rounded border border-gray-700 text-gray-400 text-xs font-mono">{form.subject_type}</div>
                  : <Select value={form.subject_type} onChange={v => setForm(f => ({ ...f, subject_type: v }))} options={domainSubjectType[activeDomain]} className="w-full" />
                }
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">
                  {form.subject_type === 'group' ? 'Group ID' : form.subject_type === 'user' ? 'User (email or *)' : 'Agent ID or FQDN'}
                </label>
                {editId
                  ? <div className="px-2 py-1.5 bg-gray-800/50 rounded border border-gray-700 text-gray-400 text-xs font-mono">{form.subject_id}</div>
                  : <Input value={form.subject_id} onChange={v => setForm(f => ({ ...f, subject_id: v }))} placeholder="sre-agent or *" className="w-full" />
                }
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">
                  {form.domain === 'agent-to-tool' ? 'Tool FQDN' : 'Target Agent FQDN'}
                </label>
                {editId
                  ? <div className="px-2 py-1.5 bg-gray-800/50 rounded border border-gray-700 text-gray-400 text-xs font-mono">{form.resource_fqdn}</div>
                  : <Input value={form.resource_fqdn} onChange={v => setForm(f => ({ ...f, resource_fqdn: v }))} placeholder="*.tools.internal or specific FQDN" className="w-full" />
                }
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-gray-600">Effect</label>
                <Select value={form.effect} onChange={v => setForm(f => ({ ...f, effect: v }))} options={['allow', 'deny']} className="w-full" />
              </div>
            </div>

            {activeDomain === 'agent-to-tool' && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-gray-600">Protocol</label>
                  <Select value={form.protocol} onChange={v => setForm(f => ({ ...f, protocol: v }))} options={PROTOCOLS} className="w-32" />
                </div>
                <div className="flex gap-3 flex-wrap">
                  {(form.protocol === 'https' || form.protocol === 'mcp') && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Path</label>
                      <Input value={form.path} onChange={v => setForm(f => ({ ...f, path: v }))} placeholder="/search or *" className="w-32" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Method</label>
                      <Select value={form.method} onChange={v => setForm(f => ({ ...f, method: v }))} options={['*', ...HTTP_METHODS]} className="w-20" />
                    </div>
                  </>}
                  {form.protocol === 'grpc' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Service</label>
                      <Input value={form.grpc_service} onChange={v => setForm(f => ({ ...f, grpc_service: v }))} placeholder="SearchService" className="w-32" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Method</label>
                      <Input value={form.grpc_method} onChange={v => setForm(f => ({ ...f, grpc_method: v }))} placeholder="Search or *" className="w-28" />
                    </div>
                  </>}
                  {form.protocol === 'postgresql' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Database</label>
                      <Input value={form.database} onChange={v => setForm(f => ({ ...f, database: v }))} placeholder="mydb or *" className="w-24" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Table</label>
                      <Input value={form.table} onChange={v => setForm(f => ({ ...f, table: v }))} placeholder="users or *" className="w-24" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Operation</label>
                      <Select value={form.operation} onChange={v => setForm(f => ({ ...f, operation: v }))} options={['*', ...DB_OPS]} className="w-24" />
                    </div>
                  </>}
                  {form.protocol === 'kafka' && <>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Topic</label>
                      <Input value={form.topic} onChange={v => setForm(f => ({ ...f, topic: v }))} placeholder="alerts-topic or *" className="w-36" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-gray-600">Operation</label>
                      <Select value={form.operation} onChange={v => setForm(f => ({ ...f, operation: v }))} options={['*', ...KAFKA_OPS]} className="w-24" />
                    </div>
                  </>}
                </div>
              </div>
            )}

            {/* Simulate result */}
            {simResult && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-xs ${
                simResult.decision === 'allow'
                  ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
                  : 'bg-red-900/30 border-red-800 text-red-300'
              }`}>
                {simResult.decision === 'allow' ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                OPA decision: <strong>{simResult.decision.toUpperCase()}</strong>
                {simResult.matched_policy_id && <span className="text-gray-500 ml-2">matched: {simResult.matched_policy_id.slice(0, 8)}…</span>}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Btn onClick={closeForm} variant="ghost"><X className="w-3 h-3" /> Cancel</Btn>
              {!editId && (
                <Btn onClick={simulate} disabled={simulating || !form.subject_id || !form.resource_fqdn} variant="ghost">
                  <Play className="w-3 h-3" /> {simulating ? 'Testing…' : 'Test Policy'}
                </Btn>
              )}
              <Btn onClick={save} disabled={saving || !form.subject_id || !form.resource_fqdn} variant="primary">
                <Check className="w-3 h-3" /> {saving ? 'Saving…' : editId ? 'Update Policy' : 'Save Policy'}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <Table heads={['Subject', 'Resource FQDN', 'Protocol / Action', 'Effect', '']}>
          {loading ? (
            <EmptyRow cols={5} msg="loading…" />
          ) : policies.length === 0 ? (
            <EmptyRow cols={5} msg={`No ${activeDomain} policies`} />
          ) : policies.map(p => (
            <tr key={p.policy_id} className="hover:bg-gray-800/30">
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Badge
                    text={p.subject_type}
                    color={p.subject_type === 'user' ? 'bg-sky-900/50 text-sky-300' : p.subject_type === 'group' ? 'bg-teal-900/50 text-teal-300' : 'bg-violet-900/50 text-violet-300'}
                  />
                  <span className="text-gray-300">{p.subject_id}</span>
                </div>
              </td>
              <td className="px-4 py-2.5 text-gray-400 font-mono text-[11px]">{p.resource_fqdn}</td>
              <td className="px-4 py-2.5 text-gray-500 text-[11px]">
                {p.protocol && <Badge text={p.protocol} color="bg-gray-800 text-gray-400" />}
                {p.action && (
                  <span className="ml-1.5 text-gray-600">
                    {p.action.path || p.action.grpc_service || p.action.database || p.action.topic || '—'}
                    {' '}
                    {p.action.method || p.action.grpc_method || p.action.operation || ''}
                  </span>
                )}
              </td>
              <td className="px-4 py-2.5">
                <Badge
                  text={p.effect.toUpperCase()}
                  color={p.effect === 'allow' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-red-900/50 text-red-400'}
                />
              </td>
              <td className="px-4 py-2.5">
                <div className="flex gap-1 justify-end">
                  <Btn onClick={() => startEdit(p)} variant="ghost" title="Edit"><Edit2 className="w-3 h-3" /></Btn>
                  <Btn onClick={() => del(p.policy_id)} variant="danger" title="Delete"><Trash2 className="w-3 h-3" /></Btn>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ── Groups Tab ────────────────────────────────────────────────────────────────

function GroupsTab() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Group | null>(null)
  const [newName, setNewName] = useState('')
  const [newMember, setNewMember] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<{ groups: Group[] }>('/groups')
      setGroups(data.groups)
    } catch { }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const createGroup = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await apiFetch('/groups', { method: 'POST', body: JSON.stringify({ name: newName.trim() }) })
      setNewName(''); load()
    } catch (e: any) { alert(e.message) }
    finally { setSaving(false) }
  }

  const delGroup = async (id: string) => {
    if (!confirm('Delete group?')) return
    await apiFetch(`/groups/${id}`, { method: 'DELETE' })
    if (selected?.group_id === id) setSelected(null)
    load()
  }

  const addMember = async () => {
    if (!selected || !newMember.trim()) return
    try {
      const updated = await apiFetch<Group>(`/groups/${selected.group_id}/members`, {
        method: 'POST', body: JSON.stringify({ user_id: newMember.trim() }),
      })
      setSelected(updated); setNewMember(''); load()
    } catch (e: any) { alert(e.message) }
  }

  const removeMember = async (userId: string) => {
    if (!selected) return
    await apiFetch(`/groups/${selected.group_id}/members/${userId}`, { method: 'DELETE' })
    const updated = { ...selected, members: selected.members.filter(m => m !== userId) }
    setSelected(updated); load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader label="User Groups" />
        <Btn onClick={load} variant="ghost"><RefreshCw className="w-3 h-3" /></Btn>
      </div>

      {/* Create group */}
      <Card>
        <div className="p-4 flex gap-2 items-end">
          <div className="space-y-1 flex-1">
            <label className="text-[10px] text-gray-600">New Group Name</label>
            <Input value={newName} onChange={setNewName} placeholder="sre-team" className="w-full" />
          </div>
          <Btn onClick={createGroup} disabled={saving || !newName.trim()} variant="primary">
            <Plus className="w-3 h-3" /> Create Group
          </Btn>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        {/* Group list */}
        <Card>
          <div className="p-3 border-b border-gray-800">
            <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Groups</p>
          </div>
          <div className="divide-y divide-gray-800/60">
            {loading ? (
              <div className="px-4 py-3 text-xs text-gray-600 font-mono">loading…</div>
            ) : groups.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-600 font-mono">No groups</div>
            ) : groups.map(g => (
              <div
                key={g.group_id}
                onClick={() => setSelected(g)}
                className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${selected?.group_id === g.group_id ? 'bg-violet-900/30' : 'hover:bg-gray-800/30'}`}
              >
                <div>
                  <div className="text-xs text-gray-200 font-mono">{g.name}</div>
                  <div className="text-[10px] text-gray-600">{g.members.length} member{g.members.length !== 1 ? 's' : ''}</div>
                </div>
                <Btn onClick={e => { e.stopPropagation(); delGroup(g.group_id) }} variant="danger" title="Delete">
                  <Trash2 className="w-3 h-3" />
                </Btn>
              </div>
            ))}
          </div>
        </Card>

        {/* Members panel */}
        <div className="col-span-2">
          <Card>
            <div className="p-3 border-b border-gray-800 flex items-center justify-between">
              <p className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">
                {selected ? `Members — ${selected.name}` : 'Select a group'}
              </p>
            </div>
            {selected ? (
              <>
                <div className="p-3 flex gap-2 border-b border-gray-800">
                  <Input value={newMember} onChange={setNewMember} placeholder="user@company.com" className="flex-1" />
                  <Btn onClick={addMember} disabled={!newMember.trim()} variant="primary">
                    <Plus className="w-3 h-3" /> Add
                  </Btn>
                </div>
                <div className="divide-y divide-gray-800/60">
                  {selected.members.length === 0 ? (
                    <div className="px-4 py-4 text-xs text-gray-600 font-mono">No members</div>
                  ) : selected.members.map(m => (
                    <div key={m} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-xs font-mono text-gray-300">{m}</span>
                      <Btn onClick={() => removeMember(m)} variant="danger"><X className="w-3 h-3" /></Btn>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="px-4 py-8 text-center text-xs text-gray-600 font-mono">
                ← Select a group to manage members
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'agents',   label: 'Agents',   icon: Server },
  { id: 'tools',    label: 'Tools',    icon: Wrench },
  { id: 'policies', label: 'Policies', icon: Lock   },
  { id: 'groups',   label: 'Groups',   icon: Users  },
]

export default function PolicyPage() {
  const [tab, setTab] = useState('agents')
  const [lastSync, setLastSync] = useState('')

  useEffect(() => {
    setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }))
    const t = setInterval(() => setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false })), 30_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

      {/* Header */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-5 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
          <Shield className="w-4 h-4 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white">Agent Control Plane</h1>
          <p className="text-[10px] text-gray-500 font-mono">Agents · Tools · Policy · Groups — live OPA enforcement</p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[10px] font-mono text-gray-600">
          <Activity className="w-3 h-3" />
          <span>synced {lastSync || '—'}</span>
          <Zap className="w-3 h-3 text-violet-500" />
          <span className="text-violet-500">Envoy · OPA</span>
        </div>
      </header>

      {/* Nav tabs */}
      <div className="bg-gray-900 border-b border-gray-800 px-5">
        <div className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-mono font-semibold border-b-2 transition-colors ${
                tab === id
                  ? 'border-violet-500 text-violet-300'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 max-w-5xl w-full mx-auto px-5 py-6">
        {tab === 'agents'   && <AgentsTab />}
        {tab === 'tools'    && <ToolsTab />}
        {tab === 'policies' && <PoliciesTab />}
        {tab === 'groups'   && <GroupsTab />}
      </div>
    </div>
  )
}
