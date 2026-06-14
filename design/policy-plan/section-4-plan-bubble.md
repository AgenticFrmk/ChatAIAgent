# Section 4 — PlanBubble + Policy Badges

## HLD

### What the user sees

Before execution starts, the chat shows a `PlanBubble` — a structured card listing every
planned step. Steps that the PolicyInterceptor flagged appear inline with badges:

- **Red shield** `blocked` — will not execute; shown for awareness
- **Amber lock** `requires approval` — agent is paused; user must approve before anything runs

The PlanBubble is also the HITL approval surface. If any step is `require_approval`, the
input bar prompt changes to "Approve all / Reject step N…" and the agent waits.

```
┌─────────────────────────────────────────────────┐
│ 🗂 Execution Plan                                │
│                                                 │
│  1  get_incident_details        ✓               │
│  2  query_metrics               ✓               │
│  3  scale_down_replicas  [⚠ Requires approval]  │
│  4  delete_old_snapshots [🛡 Blocked by policy]  │
│  5  notify_oncall               ✓               │
│                                                 │
│ 1 step requires your approval before proceeding │
└─────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Single bubble for plan | Yes | One card is easier to scan than per-step bubbles |
| Blocked steps shown | Yes, greyed out | Transparency — user sees what was suppressed and why |
| Approval surface | Same PlanBubble, not a separate dialog | Reduces context switching |
| No partial approval | v1: approve all or reject | Simpler UX; full granularity in v2 |

---

## LLD

### New types (`types.ts`)

```ts
export type PolicyDecision = 'allow' | 'block' | 'require_approval'

export interface PlanStep {
  step_number: number
  tool_name: string
  inputs: Record<string, unknown>
  reason: string                        // why this step is in the plan
  policy?: PolicyDecision               // absent = allow
  policy_rule?: string                  // human-readable rule description
}

// Extend MessageKind
export type MessageKind = 'text' | 'thinking' | 'error' | 'compaction' | 'plan'

// Extend ChatMessage
export interface ChatMessage {
  id: string
  role: MessageRole
  kind: MessageKind
  timestamp: number
  text?: string
  messagesEvicted?: number
  planSteps?: PlanStep[]                // only when kind === 'plan'
}

// Extend HitlKind
export type HitlKind =
  | 'entity' | 'clarification' | 'step_review'
  | 'analysis_summary' | 'propose_fix'
  | 'policy_review'                     // new — plan has require_approval steps
  | null
```

### New component: `PlanBubble.tsx`

```tsx
interface Props {
  steps: PlanStep[]
  timestamp: number
}

// Renders:
// - Header "🗂 Execution Plan"
// - Numbered rows: step_number, tool_name, policy badge (if any), reason on hover
// - Footer summary: "N step(s) require approval" | "All steps blocked" | nothing
// Policy badge colours:
//   require_approval → amber bg-amber-50 border-amber-300 text-amber-700
//   block            → red   bg-red-50   border-red-300   text-red-600   (greyed tool name)
```

### Updates to `ChatMessage.tsx`

```tsx
case 'plan':
  return <PlanBubble steps={msg.planSteps ?? []} timestamp={msg.timestamp} />
```

### Updates to `ChatThread.tsx`

No structural change — `ChatMessage` already iterates `messages` and delegates to kind-specific components.
