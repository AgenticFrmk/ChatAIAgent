import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  BookOpen,
  FlaskConical,
  Cpu,
  BarChart3,
  Zap,
  ArrowRight,
  ChevronRight,
  Shield,
  GitMerge,
  Sparkles,
  Lock,
  ShieldCheck,
  Layers,
  Globe,
  DollarSign,
  MessageSquare,
} from 'lucide-react'

interface Component {
  id: string
  title: string
  subtitle: string
  icon: React.ElementType
  accent: string
  role: string
  bullets: string[]
  flow: string
  highlight?: boolean
  badge?: string
}

interface Stage {
  id: string
  label: string
  number: number
  color: string
  tagline: string
  future?: boolean
  components: Component[]
}

const STAGES: Stage[] = [
  {
    id: 'build',
    label: 'Build',
    number: 1,
    color: '#C2410C',
    tagline: 'Define schemas, tools & playbooks that give agents domain knowledge',
    components: [
      {
        id: 'registry',
        title: 'Knowledge Suite',
        subtitle: 'RegistryService',
        icon: BookOpen,
        accent: '#3b82f6',
        role: 'Domain Foundation',
        bullets: [
          'Schema · Tool · Playbook registries',
          'Version-pinned agent sessions',
          'Portal UX with domain context',
          'MCP / OpenAPI knowledge ingestion',
        ],
        flow: 'Schemas & tool contracts feed into agent planning at runtime',
      },
      {
        id: 'agentcore',
        title: 'AgentCore Framework',
        subtitle: 'Build production AI agents',
        icon: Brain,
        accent: '#C2410C',
        role: 'Orchestration Engine',
        bullets: [
          'LangGraph StateGraph — 12 graph nodes',
          'Intent → Entity Confirm → Plan → HITL → Analysis → Remediation',
          'DAG executor · parallel Send API',
          'Playbook hard-rule enforcement',
        ],
        flow: 'Orchestrates the full agent lifecycle from intent to execution',
      },
    ],
  },
  {
    id: 'evaluate',
    label: 'Evaluate',
    number: 2,
    color: '#22c55e',
    tagline: 'Test agent quality with real LLM runs before shipping to production',
    components: [
      {
        id: 'evaluator',
        title: 'Evaluator Suite',
        subtitle: 'DSPy-powered testing',
        icon: FlaskConical,
        accent: '#22c55e',
        role: 'Quality Gate',
        bullets: [
          'Eval contracts per domain',
          'Real LLM test runs with DSPy',
          'MTTR · accuracy · retry rate',
          'Pass / fail gates before graduation',
        ],
        flow: 'Runs eval contracts against AgentCore to gate every deployment',
      },
      {
        id: 'analytics',
        title: 'Analytics & Scoring',
        subtitle: 'Agent performance & RAG quality metrics',
        icon: BarChart3,
        accent: '#06b6d4',
        role: 'Observability',
        bullets: [
          'MTTR · plan accuracy · step efficiency · ROI trends',
          'False-action threshold tracking · confidence calibration',
          'RAG quality — Faithfulness · Context Precision · Answer Relevancy',
          'RAGAS evaluated by SLMPlatform using BAAI/bge-small-en-v1.5 embeddings',
          'Scores stored per-run; visible in run detail drill-down',
        ],
        flow: 'Aggregates run metrics and RAG quality scores so eval results compare against eval contracts and RAGAS thresholds',
      },
    ],
  },
  {
    id: 'improve',
    label: 'Improve',
    number: 3,
    color: '#f97316',
    tagline: 'Continuously fine-tune agents from production trajectories',
    components: [
      {
        id: 'slm',
        title: 'SLM Pipeline',
        subtitle: 'Self-learning agents',
        icon: Cpu,
        accent: '#f97316',
        role: 'Learning Engine',
        bullets: [
          'Every resolved incident → quality-filtered trajectory → training set',
          'Dataset curation · SFT + DPO',
          'Fine-tune low-cost local LLMs',
          'Shadow → Hybrid → Graduated routing',
          'Richer than Salesforce xLAM — full planning trajectory + reasoning, not single-turn dispatch',
        ],
        flow: 'Turns production trajectories into specialist SLMs; routes to them once they graduate',
      },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    number: 4,
    color: '#f43f5e',
    tagline: 'Run AI agents in production with full human-in-the-loop control',
    components: [
      {
        id: 'auth',
        title: 'AuthService',
        subtitle: 'Identity & access',
        icon: Shield,
        accent: '#64748b',
        role: 'Security Layer',
        bullets: [
          'RS256 JWT issuance + key rotation',
          'User management with bcrypt passwords',
          'Configurable token TTL per session',
          'Isolated Postgres — no shared DB',
        ],
        flow: 'Issues signed JWTs that every agent call must present — no token, no access',
      },
      {
        id: 'gateway',
        title: 'AgentGateway',
        subtitle: 'Single entry point',
        icon: GitMerge,
        accent: '#0ea5e9',
        role: 'API Gateway',
        bullets: [
          'JWT verification on every request',
          'Session binding — thread_id ↔ user',
          'Redis event bus — SSE streaming',
          'Invoke · Resume · Events routing',
        ],
        flow: 'All HTTP traffic enters here; verified sessions are forwarded to AgentCore',
      },
      {
        id: 'chataigent',
        title: 'ChatAI Agent',
        subtitle: 'Chat UI — you are here',
        icon: MessageSquare,
        accent: '#f43f5e',
        role: 'Live Demo',
        highlight: true,
        badge: '▶  Live demo',
        bullets: [
          'Pure chat interface — no modals, no cards',
          '4 HITL gates: entity confirm · clarify · analysis review · plan approve',
          'Two-phase execution: diagnose first, then fix',
          'Markdown rendering · streaming step results',
        ],
        flow: 'End-to-end incident remediation via natural language — this app is the demo',
      },
    ],
  },
  {
    id: 'evolve',
    label: 'Evolve',
    number: 5,
    color: '#fbbf24',
    tagline: 'Extend platform trust to cover agent identity and tool-level authorization',
    future: true,
    components: [
      {
        id: 'dynamic-ui',
        title: 'Dynamic UI',
        subtitle: 'MCP-driven interface generation',
        icon: Layers,
        accent: '#c084fc',
        role: 'Roadmap',
        badge: '◎  On roadmap',
        bullets: [
          'FastMCP server + Assistant UI renderer',
          'SEP-1865 component schema — no hardcoded screens',
          'Redis Pub/Sub SSE pipeline: AgentBE → Gateway → Browser',
          'MCP-UI TypeScript SDK wires components to MCP actions',
          'Every new MCP tool automatically extends the UI surface',
        ],
        flow: 'Replaces fixed dashboards with query-driven interfaces — MCP tools define what is renderable; Claude decides what to render based on user intent',
      },
      {
        id: 'billing-service',
        title: 'BillingService',
        subtitle: 'Tenant-level cost tracking',
        icon: DollarSign,
        accent: '#34d399',
        role: 'Roadmap',
        badge: '◎  On roadmap',
        bullets: [
          'Three pillars: LLM tokens · data storage · cloud infrastructure',
          'Starter (PAYG) · Professional ($50/mo) · Enterprise (custom)',
          'Abstract CloudCostProvider — GCP adapter + portable estimated fallback',
          'Fire-and-forget ingest from AgentGateway and RegistryService',
          'Period finalisation + billing history API',
        ],
        flow: 'Allocates platform costs per tenant across compute, storage, and LLM consumption',
      },
      {
        id: 'agent-authz',
        title: 'Agent & Tool AuthZ',
        subtitle: 'AuthService + AgentGateway extended',
        icon: Lock,
        accent: '#38bdf8',
        role: 'Roadmap',
        badge: '◎  On roadmap',
        bullets: [
          'Agent identity — each agent instance gets a signed credential, not just the user',
          'Tool-scoped authorization — fine-grained allow/deny per tool per agent role',
          'AuthService + AgentGateway extended — no new services required',
          'Audit trail — every tool call stamped with agent identity + approval scope',
        ],
        flow: 'Closes the gap between "user is authorized" and "this agent is authorized to call this tool"',
      },
      {
        id: 'guardrails-governance',
        title: 'GuardRails & Governance',
        subtitle: 'Safety boundaries · Compliance · Policy',
        icon: ShieldCheck,
        accent: '#34d399',
        role: 'Roadmap',
        badge: '◎  On roadmap',
        bullets: [
          'Policy-as-code — define what agents can and cannot do per domain',
          'Hard guardrails — block destructive actions without explicit approval tier',
          'Compliance audit log — every tool call exportable for SOC2 / ISO27001',
          'Governance portal — domain owners set tool-scoped allow/deny policies',
          'Escalation tiers — P1 actions require senior SRE sign-off before execution',
        ],
        flow: 'Enforces safety invariants before execution reaches the tool layer',
      },
      {
        id: 'multi-agent-multicloud',
        title: 'Multi-Agent · Multi-Cloud',
        subtitle: 'DevOps spanning vendors',
        icon: Globe,
        accent: '#fb923c',
        role: 'Roadmap',
        badge: '◎  On roadmap',
        bullets: [
          'Orchestrator agent delegates sub-tasks to domain specialists — each on its own cloud',
          'Networking agent on AWS · K8s agent on GCP · Database agent on Azure',
          'AgentGateway sidecar — each AgentBE pod carries its own gateway',
          'A2A protocol — agents hand off AgentState across trust boundaries via signed JWT envelopes',
          'DynamicUI aggregates SSE streams from all agents into a single SEP-1865 canvas',
        ],
        flow: 'A single DevOps incident can span VPC peering (AWS), a GKE cluster (GCP), and Azure SQL',
      },
    ],
  },
]

const STATS = [
  { label: 'Graph nodes', value: '12' },
  { label: 'HITL gates', value: '4' },
  { label: 'Tool types', value: '4' },
  { label: 'Exec phases', value: '2' },
  { label: 'SSE events', value: '11' },
  { label: 'Eval metrics', value: '7' },
]

function ComponentCard({ component, stageColor }: { component: Component; stageColor: string }) {
  const Icon = component.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{
        background: component.highlight ? '#fff7ed' : '#ffffff',
        border: `1.5px solid ${component.highlight ? component.accent : '#e5e7eb'}`,
        borderRadius: 14,
        padding: '20px 22px',
        flex: 1,
        minWidth: 240,
        maxWidth: 400,
        boxShadow: component.highlight
          ? `0 0 24px ${component.accent}25, 0 4px 16px rgba(0,0,0,0.08)`
          : '0 2px 8px rgba(0,0,0,0.06)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${component.accent}80, transparent)`, borderRadius: '14px 14px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${component.accent}15`, border: `1px solid ${component.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: component.accent }}>
          <Icon size={17} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#111827', fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{component.title}</div>
          <div style={{ color: component.accent, fontSize: 13, marginTop: 3, fontWeight: 500 }}>{component.subtitle}</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: stageColor, background: `${stageColor}15`, border: `1px solid ${stageColor}30`, borderRadius: 20, padding: '3px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {component.role}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 14 }}>
        {component.bullets.map((b) => (
          <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
            <span style={{ color: component.accent, fontSize: 10, marginTop: 3, flexShrink: 0 }}>▸</span>
            <span style={{ color: '#374151', fontSize: 13, lineHeight: 1.5 }}>{b}</span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <ChevronRight size={13} color={stageColor} style={{ flexShrink: 0, marginTop: 1 }} />
        <span style={{ color: '#374151', fontSize: 12, lineHeight: 1.5, fontStyle: 'italic' }}>{component.flow}</span>
      </div>
      {component.badge && (
        <div style={{ marginTop: 10, background: `${component.accent}15`, color: component.accent, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'center', padding: '4px 0', borderRadius: 6 }}>
          {component.badge}
        </div>
      )}
    </motion.div>
  )
}

function StagePill({ stage, active, onClick, isLast }: { stage: Stage; active: boolean; onClick: () => void; isLast: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <button
        onClick={onClick}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 10, border: `1.5px ${stage.future ? 'dashed' : 'solid'} ${active ? stage.color : stage.future ? '#d1d5db' : '#e5e7eb'}`, background: active ? `${stage.color}12` : 'transparent', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: active ? `0 0 14px ${stage.color}25` : 'none', position: 'relative', opacity: stage.future && !active ? 0.65 : 1 }}
      >
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: active ? stage.color : '#e5e7eb', color: active ? '#fff' : '#374151', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease' }}>
          {stage.number}
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: active ? stage.color : '#374151', letterSpacing: '0.02em', transition: 'color 0.2s ease' }}>{stage.label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: active ? stage.color : '#374151', background: active ? `${stage.color}15` : '#f3f4f6', border: `1px solid ${active ? stage.color + '40' : '#e5e7eb'}`, borderRadius: 10, padding: '1px 6px', transition: 'all 0.2s ease' }}>
          {stage.future ? 'roadmap' : `${stage.components.length} ${stage.components.length === 1 ? 'component' : 'components'}`}
        </span>
        {active && (
          <motion.div layoutId="stage-underline" style={{ position: 'absolute', bottom: -2, left: 12, right: 12, height: 2, borderRadius: 2, background: stage.color }} transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
        )}
      </button>
      {!isLast && <ArrowRight size={16} color="#d1d5db" style={{ margin: '0 4px', flexShrink: 0 }} />}
    </div>
  )
}

export default function AboutPage() {
  const [activeId, setActiveId] = useState<string>('build')
  const activeStage = STAGES.find((s) => s.id === activeId) ?? STAGES[0]

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#f9fafb', color: '#111827', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #e5e7eb', background: '#ffffff', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #C2410C, #D97706)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Brain size={16} color="white" />
          </div>
          <div>
            <div style={{ color: '#111827', fontSize: 15, fontWeight: 700 }}>AgentCore Platform</div>
            <div style={{ color: '#374151', fontSize: 13, marginTop: 1 }}>A complete stack for production AI agents</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#C2410C', background: 'rgba(194,65,12,0.08)', border: '1px solid rgba(194,65,12,0.2)', borderRadius: 20, padding: '4px 12px' }}>
            Platform Architecture
          </span>
          <button
            onClick={() => setActiveId('evolve')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 20, border: '1px dashed rgba(217,119,6,0.5)', background: activeId === 'evolve' ? 'rgba(217,119,6,0.1)' : 'rgba(217,119,6,0.04)', color: '#d97706', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'all 0.2s ease', boxShadow: activeId === 'evolve' ? '0 0 10px rgba(217,119,6,0.2)' : 'none' }}
          >
            <Sparkles size={13} />
            Evolve
          </button>
        </div>
      </div>

      {/* Pipeline strip */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #e5e7eb', background: '#ffffff', padding: '16px 32px' }}>
        <div style={{ fontSize: 12, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 12 }}>
          Click a stage to explore its components
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {STAGES.map((stage, i) => (
            <StagePill key={stage.id} stage={stage} active={activeId === stage.id} onClick={() => setActiveId(stage.id)} isLast={i === STAGES.length - 1} />
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={activeStage.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2 }} style={{ marginTop: 12, fontSize: 14, color: activeStage.color, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: activeStage.color, flexShrink: 0 }} />
            {activeStage.tagline}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Stage detail */}
      <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px', background: '#f9fafb' }}>
        <AnimatePresence mode="wait">
          <motion.div key={activeStage.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${activeStage.color}15`, border: `2px solid ${activeStage.color}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: activeStage.color, fontSize: 15, fontWeight: 800 }}>
                {activeStage.number}
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#111827', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {activeStage.label}
                  {activeStage.future && (
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#d97706', background: 'rgba(217,119,6,0.08)', border: '1px dashed rgba(217,119,6,0.4)', borderRadius: 20, padding: '3px 10px' }}>
                      Future State
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: '#374151', marginTop: 2 }}>
                  {activeStage.future ? 'Not yet built — PRD & solution design in progress' : `${activeStage.components.length} platform ${activeStage.components.length === 1 ? 'component' : 'components'}`}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {STAGES.map((s) => (
                  <div key={s.id} onClick={() => setActiveId(s.id)} style={{ width: s.id === activeId ? 28 : 8, height: 8, borderRadius: 4, background: s.id === activeId ? s.color : '#e5e7eb', transition: 'all 0.3s ease', cursor: 'pointer' }} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'stretch' }}>
              {activeStage.components.map((component, i) => (
                <motion.div key={component.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.08 }} style={{ flex: 1, minWidth: 280, maxWidth: 480 }}>
                  <ComponentCard component={component} stageColor={activeStage.color} />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Stats bar */}
      <div style={{ flexShrink: 0, borderTop: '1px solid #e5e7eb', background: '#ffffff', padding: '10px 24px', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 24px' }}>
        {STATS.map(({ label, value }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ color: '#111827', fontSize: 18, fontWeight: 700 }}>{value}</span>
            <span style={{ color: '#374151', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
          </div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }}>
          <span>Built on</span>
          <span style={{ color: '#C2410C', fontWeight: 600 }}>LangGraph</span>
          <span>·</span>
          <span style={{ color: '#3b82f6', fontWeight: 600 }}>FastAPI</span>
          <span>·</span>
          <span style={{ color: '#ea580c', fontWeight: 600 }}>Claude Sonnet 4.6</span>
        </div>
      </div>
    </div>
  )
}
