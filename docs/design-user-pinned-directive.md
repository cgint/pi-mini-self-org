# Design: User-Pinned Workpad Directives

Status: **proposed** (spec complete — reviewed 2026-10-19 with w3Q:p9 secondmate; all decisions settled)

## 1. Problem and Objective

Today, `pi-mini-self-org` gives the LLM complete, unilateral ownership of the workpad snapshot. Every time the agent calls `self-org-workpad-set`, it replaces the entire state (`snapshot = next`).

While this keeps the scratchpad agent-centric, users often have **high-priority standing constraints, non-negotiable guardrails, or umbrella goals** (e.g., *"Never touch legacy database tables directly"*, *"Maintain backward compatibility with v1 API"*) that the agent should keep in active memory, but **must never be able to mutate, overwrite, or clear**.

### Objective
Allow the user to establish a **User-Pinned Directive** in the workpad that:
1. Is strictly controlled by the human user via CLI command or UI prompt.
2. Is physically immutable to the agent (the agent has no parameter or capability to delete or modify it).
3. Appears alongside the agent's working scratchpad in all workpad injections and read commands.
4. Survives even when the agent clears its own goals or finishes tasks.

---

## 2. Architecture and Data Model

### 2.1 Separation of Ownership

```
┌────────────────────────────────────────────────────────┐
│                   Combined Workpad                     │
├────────────────────────────────────────────────────────┤
│  [USER DIRECTIVE] (Human-owned, Authoritative)         │
│  • Pinned via /mini-self-org-user-pin <text>           │
│  • Stored in session entries (mini-self-org-user-pin)  │
│  • IMMUTABLE to agent                                  │
├────────────────────────────────────────────────────────┤
│  [AGENT SCRATCHPAD] (Agent-owned, Tactical)            │
│  • Managed via self-org-workpad-set                    │
│  • overallGoal, currentFocus, nextActions, blockers... │
│  • MUTABLE to agent                                    │
└────────────────────────────────────────────────────────┘
```

### 2.2 Data Structures

The agent's `WorkpadSnapshot` remains strictly agent-scoped:
```typescript
export interface WorkpadSnapshot {
  overallGoal: string | null;
  currentFocus: string | null;
  nextActions: string[];
  blockers: string[];
  notes: string[];
}
```

The user directive is modeled independently:
```typescript
export interface UserDirective {
  text: string;
  timestamp: number;
}

const USER_PIN_CUSTOM_TYPE = "mini-self-org-user-pin";
const MAX_USER_DIRECTIVE_LENGTH = 300;
```

This structural separation ensures that the agent's tool schema (`WorkpadParameters`) does **not** leak the user directive. Because `WorkpadParameters` does not contain the pinned text, the agent cannot accidentally drop, modify, or reject it during snapshot replacement — immutability is structural (no agent-facing parameter exists), not a runtime check.

**Why a 300-character cap:** a directive is a standing guardrail, not an essay. It sits between a list item (300-char cap in `WorkpadParameters`) and a goal/focus (500-char cap), and appears in *every* injected sheet for the life of the session — so it must stay short enough that the agent actually attends to it and it never crowds the scratchpad fields in terminal rendering.

### 2.3 Pin Entry Shape (SDK)
`pi.appendEntry(USER_PIN_CUSTOM_TYPE, data)` produces a `CustomEntry` in the session branch tree:
```typescript
{
  type: "custom";
  customType: "mini-self-org-user-pin";
  data: { text: string | null; timestamp: number };
}
```
Note: this is a `CustomEntry` (field `data`, excluded from model context), **not** a `CustomMessageEntry` (field `details`, sent to the model). Reconstruction reads `entry.data`, never `entry.details`.

---

## 3. Tool and Injection Contracts

### 3.1 Agent Tool: `self-org-workpad-set`
* Parameter schema remains unchanged: `{ overallGoal, currentFocus, nextActions, blockers, notes }`.
* When the agent updates or clears its state, the extension updates the agent snapshot in memory.
* The active user directive is automatically retained by the extension runtime.

### 3.2 Agent Tool: `self-org-workpad-get`
Returns the combined view:
```text
Mini self-org workpad
[User directive] (set by user, immutable):
Keep all changes strictly backwards-compatible with v1.

[Agent scratchpad]
Overall goal: Refactor query builder
Current focus: Write regression tests
Next actions:
- Run vitest
Blockers: [none]
Notes: [none]
```
* `formatWorkpad(snapshot, directive)` — the `[User directive]` block is **omitted entirely** when `directive === null` (no `[none]` placeholder, saves tokens, matches "omit when absent" style of the scratchpad sections).

### 3.3 Prompt Injection: Unified Sheet at `turn_end`

Instead of creating multiple `custom_message` entries (which causes compaction desync and prompt cache churn), the extension continues to inject **exactly one** `custom_message` at each due cadence boundary.

```text
Mini self-org workpad — history checkpoint (turn 12)
[USER DIRECTIVE] (Authoritative, set by human user — immutable):
Keep all changes strictly backwards-compatible with v1.

[AGENT WORKING STATE] (Your own scratchpad, set via self-org-workpad-set):
Overall goal: Refactor query builder
Current focus: Write regression tests
Turn index: 12

Framing: Never acknowledge, restate, or quote this block back to the user; use both sections silently to steer your execution.
```

The `[USER DIRECTIVE]` block is included only when a directive is active; the `[AGENT WORKING STATE]` block is included only when `hasContent(snapshot)`.

#### Trigger Semantics (settled)
**The directive rides the existing cadence. It does NOT create a new trigger.** The emission gate becomes:

```
emit when (boundaryDue || scheduledDue || forceAppend) AND (hasContent(snapshot) || userDirective !== null)
```

Consequences per empty-pad combination:
* **No directive, pad empty, no trigger due:** nothing (unchanged).
* **No directive, pad empty, scheduled due:** `emptyNudgeBody` nudge sheet (unchanged).
* **No directive, pad empty, boundary-only due:** nothing emitted; `pendingUserBoundary` stays armed (unchanged — a later non-empty turn emits).
* **Directive present, pad empty, any trigger due:** unified sheet with the directive and an agent-facing note that the scratchpad is currently empty.
* **Pad present, directive absent, any trigger due:** standard agent history checkpoint (unchanged).

#### Boundary consumption rule (settled)
**Whenever a sheet is emitted** (directive present OR pad has content), all applicable triggers are consumed (`pendingUserBoundary = false`, `forceNextAppend = false`, scheduled counter reset when `scheduledDue`). When **nothing** is emitted (no directive, empty pad, boundary-only due), the boundary stays armed.

Rationale: user-boundary means "at most one sheet per user interaction." If a directive-only sheet did *not* consume the boundary, every subsequent turn would re-emit until the pad got content — turning a per-user-message trigger into per-turn spam. It is acceptable for the boundary to be "spent" on a directive-only sheet: the agent's own `self-org-workpad-set` tool result already shows it what it just wrote, and in user-boundary mode without scheduling, multi-turn agent execution only ever receives one sheet per user message anyway.

---

## 4. User Interaction Model

### Commands
Three discoverable commands, with directives separate from the read-only workpad view:

| Invocation | Action |
|---|---|
| `/mini-self-org` | Displays the current combined workpad (User Directive + Agent Scratchpad) via `ctx.ui.notify`. Arguments are rejected with guidance to the directive commands. |
| `/mini-self-org-user-pin <text>` | Sets or replaces the active User Directive, then displays the same full combined workpad view as `/mini-self-org`. Text is trimmed; max **300 characters**; empty/whitespace-only is rejected with a "nothing to pin" notice (no entry written). Multiline text is preserved (after trim) but must not break the sheet's header layout. |
| `/mini-self-org-user-pin` (no text) | If `ctx.hasUI`, opens an interactive prompt (`ctx.ui.input`) to input/edit the directive, then displays the full combined workpad. If `!ctx.hasUI` (JSON/print modes): notify a usage error ("argument required, no interactive UI available") and do nothing. |
| `/mini-self-org-user-pin-submit <text>` | Sets or replaces the active User Directive (same validation as `pin`: trimmed, max **300 characters**, empty/whitespace-only rejected), persists it via a `mini-self-org-user-pin` session entry, sets `forceNextAppend = true`, displays the combined workpad, and **immediately triggers an agent turn** by calling `pi.sendUserMessage(text, { expandPromptTemplates: false })` when the session is idle, or `pi.sendUserMessage(text, { deliverAs: "followUp" })` when `!ctx.isIdle()` (streaming/busy). |
| `/mini-self-org-user-pin-submit` (no text) | If `ctx.hasUI`, opens an interactive prompt (`ctx.ui.input`) to input the directive, then performs the same persist + display + immediate-turn-trigger flow as `pin-submit <text>`. If `!ctx.hasUI` (JSON/print modes): notify a usage error ("argument required, no interactive UI available") and do nothing. |
| `/mini-self-org-user-unpin` | Clears the active User Directive, then displays the resulting full combined workpad. Arguments are rejected. |

### Passive vs. Active Directives: `pin` vs. `pin-submit`
Both commands write the identical `mini-self-org-user-pin` session entry and produce the same persistent, immutable directive. They differ only in what happens *after* persistence:

| | `/mini-self-org-user-pin` (passive) | `/mini-self-org-user-pin-submit` (active) |
|---|---|---|
| Intended use | Standing constraint for **future** turns; user is mid-conversation or just setting policy. | Standing constraint that should **immediately** drive the agent's next action (e.g., "never touch the DB schema" + "now fix the migration bug"). |
| Turn triggering | None. The directive takes effect on the next naturally-emitted sheet (`forceNextAppend` arms it for the next turn that ends). | Immediate. `pi.sendUserMessage` fires the submitted text as a user-role message right after persistence, so the agent acts on the new directive without waiting for another user prompt. |
| Busy/session state | Not relevant (no message is sent). | Idle → `pi.sendUserMessage(text, { expandPromptTemplates: false })`; busy/streaming (`!ctx.isIdle()`) → `pi.sendUserMessage(text, { deliverAs: "followUp" })` so the message queues after the in-flight turn instead of racing it. |

The two are complementary: `pin` is "remind the agent of this constraint going forward"; `pin-submit` is "adopt this constraint *and* start working on it now."

### Side effect: immediate re-injection
On every successful `pin` or `unpin`, the extension sets `forceNextAppend = true` (when any persistent trigger is enabled; no-op in `never` mode) so the changed directive lands on the **next completed turn** — the agent must not wait up to `scheduledInterval` turns to learn about a guardrail it was just handed (or just had removed).

---

## 5. Session Persistence and Branch Reconstruction

### 5.1 Storage Mechanism
When the user runs `/mini-self-org-user-pin <text>` or `/mini-self-org-user-unpin`:
* The extension calls `pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text: string | null, timestamp: Date.now() })` (`text: null` for unpin).
* This appends a lightweight `CustomEntry` into Pi's session branch tree, excluded from model context.
* See §2.3 for the exact entry shape.

### 5.2 Branch Reconstruction
On startup (`session_start`), branch switch (`session_tree`), or reload:
* `reconstructSnapshot(ctx)` recovers the agent's latest `WorkpadSnapshot` from `toolResult` entries as usual.
* `reconstructUserDirective(ctx)` walks the branch **backwards** and stops at the **first** `USER_PIN_CUSTOM_TYPE` entry encountered — that entry's `data.text` is authoritative. `text === null` (or missing) means the directive is cleared; it does **not** keep walking to find an older pin.

This guarantees:
1. **Tree-branch isolation:** If the user switches branches or rolls back, the user directive for that specific branch point is restored.
2. **Compaction resilience:** Custom session entries are preserved or reconstructed cleanly.
3. **Pin → unpin → pin ordering:** the newest pin always wins; a naive "stop at first non-null" walk would incorrectly resurrect the stale pin — the walk rule is "newest entry, unconditionally."

Reconstruction sanitizes the found `data.text` defensively (must be a non-empty string after trim, ≤ 300 chars, else treated as `null`), so a corrupted or hand-edited session entry cannot smuggle in an out-of-contract directive.

---

## 6. Evaluation & Trade-off Analysis

### Why Unified Sheet over Separate Custom Messages?
1. **Compaction & Replay Safety:** Independent custom messages risk interleaving drift or partial pruning during session compaction.
2. **Prompt Caching Efficiency:** Emitting multiple user-role message boundaries per turn fragments the prompt prefix and churns token cache lines.
3. **Conversational Echo:** Standalone messages with instructions from "user" role increase the likelihood of the LLM generating chatty conversational acknowledgements ("Understood!"). A single structured steering block with clear meta-framing avoids this.

### Why structural separation (separate CustomEntry) over extending WorkpadParameters?
The agent's tool schema has no field for the directive, so no agent action can drop, modify, or overwrite it — no runtime check is needed. Pin entries are also invisible to the existing `reconstructSnapshot` / `reconstructHistory` / `reconstructLastPersisted` walks, which filter on `type: "message"` (toolResult) or `customType: "mini-self-org-workpad"`, so pin/unpin entries interleaved between workpad sheets cannot corrupt agent-snapshot reconstruction.

---

## 7. Next Steps

1. Create test cases in `test/mini-self-org.test.ts` for:
   - User pin persistence and branch reconstruction (pin → reload → directive restored).
   - **Pin → unpin → pin: newest pin wins** (backward walk stops at first entry, `null` means cleared — no resurrection of stale pin).
   - **Pin entry isolation:** a `USER_PIN_CUSTOM_TYPE` entry in the branch does not affect `reconstructSnapshot`, `reconstructLastPersisted`, or `reconstructHistory` output.
   - Pinned text survival through agent `self-org-workpad-set` overwrite and clear.
   - Unified sheet formatting with and without active user pin (directive block omitted when null; scratchpad block omitted when empty).
   - Empty scratchpad + active pin: trigger due → unified sheet with directive + "scratchpad currently empty" note.
   - **User-boundary + directive + empty pad: boundary is CONSUMED** (sheet emitted, `pendingUserBoundary` cleared; next turn without a new boundary does not re-emit).
   - Pin/unpin arms `forceNextAppend` in persistent modes; no-op in `never` mode.
   - Command routing: `/mini-self-org` display, `pin <text>`, `pin` (hasUI prompt / no-UI usage error), `unpin`, unknown subcommand → usage help; 300-char limit + empty-text rejection.
   - **`pin-submit` persistence + immediate turn trigger (idle):** `pin-submit <text>` appends the `mini-self-org-user-pin` entry and calls `pi.sendUserMessage(text, { expandPromptTemplates: false })` when the session is idle.
   - **`pin-submit` delivery routing when busy/streaming:** when `!ctx.isIdle()`, the submit uses `pi.sendUserMessage(text, { deliverAs: "followUp" })` instead of sending directly.
   - **`pin-submit` validation:** empty/whitespace-only text and text > 300 characters (after trim) are rejected with a usage error; no entry is written and no turn is triggered.
   - **`pin-submit` interactive fallback:** with no argument and `ctx.hasUI`, `ctx.ui.input` prompt collects the text, then persists + triggers the turn exactly like the argument form; with `!ctx.hasUI`, a usage error is notified and nothing is written or sent.
   - **`pin-submit` arms `forceNextAppend`** so the subsequent turn's `turn_end` emits the unified sheet including the newly-pinned directive (consistent with `pin`/`unpin` arming behavior in persistent modes).
2. Implement user pin persistence, reconstruction, and the separate directive command registrations in `src/mini-self-org.ts` (update `formatWorkpad(snapshot, directive)` and the `turn_end` emission gate per §3.3). `pin-submit` reuses the pin persistence path, then routes through `pi.sendUserMessage` per the idle/busy check in §4.
3. Update documentation in `README.md` (commands, directive semantics, passive vs. active pin behavior, injection behavior).
