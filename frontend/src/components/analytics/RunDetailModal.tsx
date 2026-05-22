import { Loader2, X } from 'lucide-react'
import { useRunDetail, type RAGASScores } from '../../hooks/useAnalytics'
import MetricTooltip from './MetricTooltip'

const THRESHOLDS = {
  faithfulness:       0.80,
  context_precision:  0.75,
  answer_relevancy:   0.80,
}

const LABELS: Record<keyof typeof THRESHOLDS, string> = {
  faithfulness:      'Faithfulness',
  context_precision: 'Context Precision',
  answer_relevancy:  'Answer Relevancy',
}

const TOOLTIPS: Record<keyof typeof THRESHOLDS, string> = {
  faithfulness:      'Can every claim in the response be directly inferred from the retrieved contexts? Two LLM calls: decompose response into atomic statements, then NLI-check each against the context. Score = verified ÷ total statements.',
  context_precision: 'Were the most useful context chunks ranked highest? Uses Average Precision — rewards relevant chunks appearing early in the list. One LLM call per context chunk. Also called ContextUtilization in RAGAS.',
  answer_relevancy:  'Does the response actually answer the original question? Three LLM calls reverse-engineer questions from the answer, then cosine similarity between their embeddings and the original question is averaged.',
}

function scoreColor(value: number, threshold: number): string {
  if (value >= threshold) return 'bg-green-500'
  if (value >= threshold - 0.10) return 'bg-amber-500'
  return 'bg-red-500'
}

function ScoreBar({ metric, value }: { metric: keyof typeof THRESHOLDS; value: number }) {
  const threshold = THRESHOLDS[metric]
  const pct = Math.round(value * 100)
  const color = scoreColor(value, threshold)
  const passing = value >= threshold

  return (
    <div className="flex items-center gap-3">
      <span className="w-40 text-xs text-gray-600 shrink-0 flex items-center">
        {LABELS[metric]}
        <MetricTooltip text={TOOLTIPS[metric]} />
      </span>
      <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono w-10 text-right ${passing ? 'text-green-600' : 'text-red-500'}`}>
        {value.toFixed(2)}
      </span>
    </div>
  )
}

function RAGASPanel({ scores }: { scores: RAGASScores }) {
  return (
    <div className="flex flex-col gap-3">
      {(Object.keys(THRESHOLDS) as (keyof typeof THRESHOLDS)[]).map(metric => (
        <ScoreBar key={metric} metric={metric} value={scores[metric]} />
      ))}
      <p className="text-xs text-gray-600 mt-1">
        Thresholds — Faithfulness ≥0.80 · Context Precision ≥0.75 · Answer Relevancy ≥0.80
      </p>
    </div>
  )
}

interface Props {
  runId: string
  agentId: string
  token: string | null
  onClose: () => void
}

function fmt(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

export default function RunDetailModal({ runId, agentId, token, onClose }: Props) {
  const { detail, loading, error } = useRunDetail(agentId, runId, token)
  const ragasPending = detail !== null && detail.ragas_scores === null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white border border-gray-200 rounded-xl w-full max-w-lg mx-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <p className="text-xs font-mono text-gray-600">Run</p>
            <p className="text-sm font-mono text-gray-900">{runId.slice(0, 16)}…</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-gray-900 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-5">
          {loading && (
            <p className="text-sm text-gray-600 text-center py-4">Loading…</p>
          )}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
          {detail && !loading && (
            <>
              {/* Run summary */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
                <span>{new Date(detail.finished_at).toLocaleString()}</span>
                <span className="capitalize">{detail.resolution_type.replace('_', ' ')}</span>
                <span>MTTR {fmt(detail.mttr_seconds)}</span>
                <span className={detail.outcome === 'resolved' ? 'text-green-600' : 'text-red-500'}>
                  {detail.outcome}
                </span>
              </div>

              {/* RAGAS scores */}
              <div>
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-3">
                  RAG Quality
                </h3>
                {detail.ragas_scores ? (
                  <RAGASPanel scores={detail.ragas_scores} />
                ) : ragasPending ? (
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Evaluating RAG quality…</span>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600">
                    No RAGAS scores recorded for this run.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
