# Design: history-scheduled workpad injection (replaces the transient tail)

Date: 2026-09-16 · Status: **DESIGN PROPOSAL — no code written; every harness claim below
is verified against the installed Pi sources, each numbered `[F#]` with an
exactly-checkable location.** Version note (2026-10-03): the boundary-draft API
(`TurnEndEvent extends BoundaryState` with `outcome`, `CustomMessageEntryDraft`, the
`{entries?}` return at `turn_end`) first landed in Pi **0.87.0**; this design is
implemented against **1.0.0** (devDependency `^1.0.0`, peer `>=0.87.0`). The original
"0.85.1" verification target was stale — that version does not carry this API.

Proposes replacing the transient tail-sheet injection mechanism with a persistent
history-sheet mechanism: every N agent turns, the workpad snapshot is appended to the
session transcript as a `custom_message` entry. The transient `context`-hook injection
is retired in this mode. The primary goal is **memory/retention** — the model reliably
holds its own workpad state across long work. Cache effects are observed, not chased.

---

## 1. Why: the transient tail is the wrong primitive for the actual goal

**The actual goal** (the extension's core purpose since day one): the model reliably
*remembers* its workpad steering — goal, focus, next actions, blockers, notes — across
long work sessions, without the user having to re-state it.

**What the current mechanism does** (`src/mini-self-org.ts:348-368`, `pi.on("context")`):
before every LLM call, strip any previous transient sheet, append the current snapshot
as a request-local custom message at the tail. Three properties:

- **Request-local.** Never persisted; the sheet never appears in the session JSONL.
- **Churns the tail.** Any `workpad-set` write changes the next request's last message.
- **Redundant with history.** Every `workpad-set` call *already* persists its arguments
  (the full snapshot) and result into the transcript (copies ① and ②, roadmap §1–2).
  The model already sees its own prior writes in the cached prefix. The transient sheet
  is a *re-summarization* of what's already in history, placed at the attention frontier.

**What the user observed:** the tail churn coincided with warm-prefix cache misses on
Gemini 3.7/3.8 (run-unique replications, `cache-test-matrix.md`). Causation is not
established (routing/provider policy unexcluded), but the observation motivated the
question: *is there a way to keep the sheet visible to the model without per-call tail
churn?*

**The answer this design proposes:** yes — persist the sheet into the transcript at a
bounded cadence. The sheet becomes part of history (stable prefix after the fact), not
a per-call tail whisper. The model's workpad state is then *in* the conversation it
reads, the way a tool result would be.

**What the workpad writes already provide (and this mode does NOT replace):**

| Copy | Where | Reaches LLM | Persists | Role |
|------|-------|-------------|----------|------|
| ① | `tool_call` args of every past `workpad-set` | yes (cached prefix) | yes | In-context proof the state is the agent's own prior act |
| ② | `toolResult.details.snapshot` | **never** (never serialized into provider requests) | yes, survives compaction | Durable store; reconstruction source |
| ③ (current) | Transient tail sheet | yes, per policy | **no** | Re-summarized current state at the frontier |

This mode replaces copy ③ with a **persistent history sheet** (call it ③′): a
`custom_message` entry appended every N turns, containing the current snapshot. Copy ②
remains the durable record; copy ① remains the in-context proof of own act. The history
sheet is a *recency aid* — it ensures the model doesn't have to hunt for the last
`workpad-set` deep in a long branch.

**What "every N agent turns" means precisely:** N `turn_end` events (one per model
round that produced an assistant message, F1). A tool batch inside one turn is one
action from the model's point of view. Counting LLM calls would re-couple to the
transient mechanism we're retiring.

**What the premise does NOT establish:**

- That tail churn *caused* the 3.7/3.8 misses (roadmap §3: model-specific observations,
  unexcluded alternatives).
- That the model *needs* periodic re-summarization. With `always` it sees the sheet on
  every call; copies ①/② already carry the state. The history sheet's value is *recency
  placement*, not information content. This must be shown by retention testing, not
  assumed.

**Consequence:** this mode is a **replacement with measured transition**, not a fourth
arm alongside. The honest path is three steps (secondmate's sequencing, §11):
1. Implement `history-scheduled` as a configurable mode (transient mechanism still available).
2. Measure retention (primary) + cache/cost (secondary) against the old behavior.
3. Then delete the transient machinery — the end-state is *smaller* code.

---

## 2. Verified harness facts (the load-bearing evidence)

Each fact numbered, with exact file:line in the **installed** package
(`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`). Pi 1.0.0.

| # | Fact | Location | Re-verify |
|---|------|----------|-----------|
| F1 | `turn_end` fires once per model round, after the assistant message and its tool results are finalized. Shape: `{ type, turnIndex, message, toolResults, messageEntryId, toolResultEntryIds, outcome }`. | `types.d.ts:786-794`; `agent-session.js:476-508` | `rg -n "TurnEndEvent" dist/core/extensions/types.d.ts` |
| F2 | Boundary handler may return `{ entries?: SessionBoundaryDraft[], continue?: boolean }`. | `types.d.ts:739-756` | `rg -n "SessionBoundaryDraft" dist/core/extensions/types.d.ts` |
| F3 | `CustomMessageEntryDraft = { type: "custom_message", customType, content, display, details? }`. | `types.d.ts:719-725` | `rg -n "CustomMessageEntryDraft" dist/core/extensions/types.d.ts` |
| F4 | Returned entries are committed to the session by `_commitBoundaryDrafts`, regardless of `continue`. | `agent-session.js:501-507, 623-627` | `rg -n "_commitBoundaryDrafts" dist/core/agent-session.js` |
| F5 | `continue: true` at `turn_end` **extends a finished run by one model round only when the user has queued steering** (`hasQueuedMessages()` = steering+followUp queues). It does NOT override a natural stop; if nothing is queued, the wrapped decision is `"end"` and the extension's `continue` is ignored. When it does fire, it is a billable model round. | `agent-session.js:509-521`; agent loop in `chunk-33XOIQ5N.js` | `rg -n "_installAgentBoundaryHooks" dist/core/agent-session.js` |
| F6 | `agent_before_settle` runs inside a `while(true)` drain loop. | `agent-session.js:1355-1375` | `rg -n "_runBeforeSettleBoundary" dist/core/agent-session.js` |
| F7 | Continuation gated by `canContinue`; if gate fails, harness logs and drops continuation (entries already committed). | `agent-session.js:603-622, 503-505` | `rg -n "canContinue" dist/core/agent-session.js` |
| F8 | `custom_message` entries persist as session-tree entries, become `role:"user"` in LLM projection. | `docs/session-format.md:181,244`; `chunk-JVUZSMYM.js` | `rg -n "custom_message" docs/session-format.md` |
| F9 | Docs: "Guard continuation conditions because an unconditional continuation can loop." | `docs/extensions.md:117` | `rg -n "actionable boundaries" docs/extensions.md` |
| F10 | Existing transient mechanism: `context` hook strips + conditionally appends per policy. | `src/mini-self-org.ts:23-34, 348-368` | `rg -n "callsSinceLastInjectionOrWrite" src/mini-self-org.ts` |
| F11 | Copy ②: `toolResult.details.snapshot` never serialized into provider requests; reconstruction reads only `toolResult` entries. A `custom_message` sheet is invisible to `reconstructSnapshot`/`reconstructHistory`. | `src/mini-self-org.ts:119-140, 170-199` | `rg -n "details" src/mini-self-org.ts` |
| F12 | Measured cache context: Gemini 3.7/3.8 run-unique first-B misses; 3.5 retained 4,074; Anthropic Haiku / Copilot Terra CONTROLLED PASS. | `cache-test-matrix.md` | in-repo docs |

**Design facts (what F1–F9 jointly imply):**

- **D1 — Entries-without-continue is sufficient.** Appending a `custom_message` at
  `turn_end` persists it (F4); the next natural model request includes it (F8). No
  forced turn, no loop surface.
- **D2 — `continue: true` is the wrong primitive.** F5: only prolongs queued-steering
  runs, unreliable as re-read, billable when it fires. F6: settle hook is a drain-loop
  surface. **This design never requests continuation.**

---

## 3. Requirements

- **R1 Memory/retention (PRIMARY):** the model reliably holds its workpad state across
  long work. The history sheet is the mechanism: it lands in the transcript every N
  turns, so the model's effective context contains a recent, re-summarized snapshot
  without per-call tail churn. Staleness up to N turns is the accepted price. Between
  appends, the model's only sheet-recency source is copies ①/② (buried tool-call
  args) — if retention drifts mid-window, the fix is N, not resurrecting the tail.
- **R2 Self-ownership without repetition:** the sheet reads as the agent's own state;
  a request must never contain two copies. Enforced by §4.3 (transient mechanism
  retired in this mode).
- **R3 Actionable guidance:** appended body keeps full field lists (nextActions,
  blockers, notes).
- **R4 Durability:** copy ② (`details.snapshot`) survives reload/branch/compaction.
  This mode does not touch it (F11).
- **R5 Provider-safe caching:** no default change without measurement; no
  provider-payload surgery, no synthetic tool events, no fabricated history (roadmap
  §0.1 prohibitions). Sheets are appended *forward* at turn boundaries — never
  inserted into or edited into past turns (that would churn the stable prefix and
  fabricate history).
- **R6 Bounded work:** in T turns, at most `floor(T/N)` sheets + one forced sheet per
  compaction event. No runaway appends, no continuation loop.

---

## 4. The plan

### 4.1 Configuration surface

```
MINI_SELF_ORG_INJECTION=history-scheduled:<N>   # N ∈ [1, MAX_SAFE_INTEGER]
```

- Policy shape: `{ mode: "history"; interval: N }`.
- Grammar: `/^history-scheduled:([1-9]\d*)$/`.
- Invalid values throw at initialization (existing fail-fast contract).
- During the transition period (§1 consequence step 1–3), the three existing arms
  (`always`, `user-boundary`, `scheduled:N`) were available. **Step 8 (2026-10-03)
  is now DONE:** the transient machinery is deleted; `history-scheduled:<N>` is the
  only injection mode (plus `off`). The transition period is over.

### 4.2 `turn_end` handler — passive append, no continuation

```
pi.on("turn_end", async (event) => {
  if (injectionPolicy.mode !== "history") return undefined;
  if (event.outcome !== "completed") return undefined;   // Q2: skip aborted/error
  turnsSinceLastAppend += 1;
  if (turnsSinceLastAppend < injectionPolicy.interval) return undefined;
  if (!hasContent(snapshot)) return undefined;
  // RE-APPEND EVERY N TURNS regardless of change: the goal is RECALL (R1), not
  // dedup. A static goal must stay at the frontier; appending it once and letting it
  // sink into history silently destroys retention (advisor finding, 2026-09-16).
  // `lastPersisted` is still updated (for §4.5 reconstruction) but does NOT gate append.
  lastPersisted = { ...snapshot, lists: copied };
  turnsSinceLastAppend = 0;
  return {
    entries: [{
      type: "custom_message",
      customType: WORKPAD_CUSTOM_TYPE,
      content: historySheetBody(snapshot),
      display: false,
      details: { snapshot: { ...snapshot, lists: copied } },  // machine-readable, invisible to provider (F11)
    }],
  }; // no `continue` — D2
});
```

State: `turnsSinceLastAppend`, `lastPersisted` (recovered from `details` at
reconstruction, §4.5).

Guard semantics:
- **Re-append every N turns when the snapshot has content — the change gate is REMOVED.**
  The primary goal is memory/retention (R1): the model must see its workpad state at a
  regular cadence, not only when it changed. Gating on `sameSnapshot` would append a
  static goal exactly once and then let it sink into history, defeating R1. `lastPersisted`
  is retained solely for §4.5 reconstruction (so a reload doesn't miscount the window),
  not to suppress appends. (Corrected 2026-09-16 after advisor review: the original
  "material-change gate" was a dedup heuristic borrowed from the cache framing; it is
  wrong for the memory framing.)
- **Frequency governs when; content governs whether.** A write does NOT reset the
  window (Q4, resolved). Bounded cadence is the contract.
- **No `continue`** (D2).
- **Aborted/error turns don't count** (Q2).

### 4.3 Replacement of the `context` hook (not de-confliction)

In `history` mode:
- The `context` hook's **append path is removed** (not guarded): `shouldInject` is
  unconditionally false. The transient tail sheet does not exist.
- The `context` hook's **filter path remains**: strips any `WORKPAD_CUSTOM_TYPE`
  custom messages from `event.messages`. This handles the reload edge (session started
  in `always`, resumed in `history-scheduled:N`).
- `pendingUserBoundary`, `forceNextInjection`, `callsSinceLastInjectionOrWrite` are
  no-ops in this mode.

End-state (current, after step 8, 2026-10-03): the `context` hook's **append path** is
  deleted entirely; the hook remains as a **strip-only** mechanism (removes stale workpad
  custom messages from `event.messages`). The `turn_end` handler is the sole injection
  mechanism.

### 4.4 Compaction behavior

`session_compact` → set `forceNextAppend = true` (history mode only). At the next
`turn_end`, the counter wait is bypassed: one fresh sheet is appended regardless.
Cleared after use. Bounded: at most one forced sheet per compaction event (R6).

Reasoning: compaction summarizes away mid-history sheets; this is exactly when R1
(frontier recency) is most at risk. One bounded append restores a sheet behind the
compaction summary.

### 4.5 Reconstruction on reload / branch switch

`reconstruct(ctx)` additionally, in history mode:
1. `snapshot = reconstructSnapshot(ctx)` — unchanged (copy ②, F11).
2. `lastPersisted` = newest `WORKPAD_CUSTOM_TYPE` `custom_message` entry on the branch,
   read from its `details.snapshot` (F3's `details` field; invisible to provider by
   F11). `null` if absent.
3. `turnsSinceLastAppend = 0`.

### 4.6 What does NOT change

- `mini-self-org-workpad` tool + `details.snapshot` (copy ②) — untouched.
- `mini-self-org-history` tool — reads only `toolResult` entries (F11); sheets are
  invisible to it by construction. The focus-history timeline reflects deliberate agent
  updates, not mechanical resyncs. Pinned by T6.

---

## 5. Rejected alternatives

| Alternative | Rejected because |
|-------------|------------------|
| `continue: true` on each append | F5: unreliable (only fires with queued steering), billable when it does, drain-loop surface at settle (F6). The user's "like a forced tool call" = *where the sheet lives* (history), not spend turns. |
| `agent_before_settle` instead of `turn_end` | F6: drain-loop risk. `turn_end` fires once per model round — correct granularity. |
| `pi.sendMessage()` with `triggerTurn` | Same cost as `continue`, bypasses boundary accounting. |
| Append on every workpad *write* (no interval) | Recreates write-boundary churn — the exact pattern being eliminated. |
| Keep transient tail AND append history sheets | Violates R2 (two sheets per request); redundancy, not safety. |
| Replace copy ② with sheets as durable store | Sheets are text; compaction may summarize them away. Copy ② is SOLVED (roadmap). |
| Retro-edit past turns (`context_edit`) to place sheets | Churns stable prefix (cache sin) + fabricates history (roadmap §0.1 prohibition). Append-only, forward. |

---

## 6. Open questions

- **Q1 (compaction forced append):** **Resolved: yes** — adopt §4.4. Bounded (one forced
  sheet per compaction event, R6). Falsifier if ever revisited: if compaction summaries
  reliably retain the sheet, the forced append is redundant cost.
- **Q2 (aborted turns):** **Resolved: yes** — skip counting `outcome !== "completed"`.
  Keep simple first; falsifier is interrupt-heavy sessions where the window never fills.
- **Q3 (sheet body phrasing):** history checkpoint phrasing with turn-index marker
  (from `event.turnIndex`), plus: "later tool activity may supersede this;
  authoritative state is maintained via the workpad tool." (Secondmate's proposal,
  adopted.) The marker doubles as a payload-locating aid for measurement.
  **REQUIRED (secondmate final sign-off, 2026-09-16):** the body must ALSO carry the
  self-ownership line — "This is your own workpad state (set via mini-self-org-workpad);
  never acknowledge, restate, or quote this block back to the user" — inherited from the
  transient body, to prevent echo induction from N identical user-role sheets (R2).
- **Q4 (write resets counter?):** **Resolved: no.** Frequency is the contract; a write
  only arms the counter window, not the append itself (the change-gate is gone).
  (Secondmate concurred independently.)
- **Q5 (delta-stub fallback, pre-planned, NOT built in step 1):** if measured token bloat
  from re-appending the full ~150-token sheet every N turns exceeds ~10–15% of context
  budget without retention loss, switch unchanged windows to a one-line stub — "Workpad
  unchanged since last checkpoint (turn k)" (~15 tokens) — with the full body only on
  change. This is the middle ground between pure repetition (current) and the dedup gate
  (removed). Falsifiable trigger: "stub beats full-body if bloat > threshold with no
  retention regression." Pre-committing the stub is the one reason `lastPersisted` stays.
  This is a documented fallback, not a step-1 build (secondmate, 2026-09-16).

---

## 7. Success criteria and measurement

**Primary (memory/retention):** does the model act on workpad steering across long
spans? Test: scripted session with a workpad state set at turn 1, then N×3 turns of
unrelated work; at turns 1+N, 1+2N, 1+3N the sheet is appended; check whether the
model's actions at turns between appends reflect the workpad state (vs. drifting).
Compare: history-scheduled vs. always (control) vs. no-sheet (copies ①/② only).

**Secondary (cache/cost):** observed, not gating.
- Arms: `always` (control), `scheduled:N` (isolating control: separates *cadence* from
  *persistence*), `history-scheduled:N`, same N, same state-change schedule.
- Payload controls per `cache-test-matrix.md` status contract.
- Cost side: added context ≈ `min(T/N, distinct-states·T/N)` sheet bodies; compare
  against the 0.48% persisted-footprint baseline (roadmap §3).

**Stop signal:** if on ≥2 distinct provider cells the history arm shows *worse*
warm-prefix retention than `always` at the same state-change frequency, OR if retention
testing shows no improvement over copies ①/② alone (i.e., the model doesn't benefit
from the re-summarized sheet), the mechanism is not the lever — record as measured
negative in `cache-test-matrix.md` and stop.

---

## 8. Implementation steps

1. **Policy:** add `history-scheduled:<N>` to `parseInjectionPolicy` + T1.
2. **State:** `turnsSinceLastAppend`, `lastPersisted` (+ `details`-based
   reconstruction, §4.5) + reconstruction tests.
3. **`turn_end` handler** with all §4.2 guards + T2, T3, T4, T7.
4. **`context` hook: remove append path in history mode** (strip-only) + T5.
5. **Compaction flag** (Q1) + T8.
6. **Docs/README:** document the mode, R1 trade-off (staleness ≤ N turns), Q4 rule.
7. **Runtime verification:** live session with `history-scheduled:4`; inspect JSONL
   for `custom_message` entries; run §7 retention test + one cache A/B on Gemini 3.7/3.8.
8. **(After measurement, §1 consequence step 3):** ✅ DONE (step 8, 2026-10-03). Transient machinery deleted; `history-scheduled:<N>` is the only injection mode (plus `off`). `parseInjectionPolicy` simplified to accept only `history-scheduled:<N>` or `off`. The `always`, `user-boundary`, and `scheduled:N` modes are removed. The `context` hook is strip-only (no injection). Two src fixes applied: (a) session-cumulative turn counter for Q3 marker integrity (replaces within-invocation `event.turnIndex`); (b) strip scoping confirmed already-correct (F8: history sheets are projected as `role:"user"`, not `role:"custom"`, so the strip filter doesn't match them).

---

## 9. Test plan (`test/mini-self-org.test.ts`)

| # | Test | Asserts |
|---|------|---------|
| T1 | Policy parsing | `history-scheduled:8` → `{ mode: "history", interval: 8 }`; invalid values throw |
| T2 | Counter (cadence) | N−1 `turn_end`s → no entries; Nth → one `custom_message` (customType, `display: false`, `details.snapshot`), no `continue` key. Holds whether or not the snapshot changed since last persist (gate removed). |
| T3 | Window reset | after append, N more `turn_end`s needed |
| T4 | Write does NOT reset window (Q4) | workpad write at turn k<N → no early append |
| T5 | Context hook append path removed | in history mode, `context` handler never adds a workpad message; only strips |
| T6 | History-tool isolation | `reconstructHistory` identical with vs. without sheets (F11) |
| T7 | Cadence (R1) | 3·N turns, constant (non-empty) snapshot → exactly THREE sheets (one per window), proving static goals are re-appended, not sunk |
| T8 | Compaction force (Q1) | after `session_compact`, next `turn_end` appends despite unchanged; next does not |
| T9 | Reload reconstruction | branch with `custom_message` sheet → `lastPersisted` read from `details`; `turnsSinceLastAppend` reset to 0; first full window elapses before the next append (cadence, not dedup). |
| T10 | Post-compaction reconstruction edge | newest sheet in summarized region → `lastPersisted` = older visible sheet or null; cadence still governed by `turnsSinceLastAppend`. |

---

## 10. Out of scope

- Changing the `always` default (roadmap §0.1).
- Any `agent_before_settle` usage (F6).
- Any `continue: true` (D2/F5).
- Modifying `mini-self-org-history` semantics (F11).
- Provider-payload surgery, synthetic tool events, fabricated history (roadmap §0.1).
- Retro-editing past turns (R5).

---

## 11. Peer review record

**2026-09-16 — secondmate (herdr pane w2C:p2, same-level design debate, read-only):**

- **F5 correction (accepted, verified, applied):** first draft claimed `continue: true`
  "overrides the agent's natural end." Secondmate identified the wrapped `finishTurn`'s
  `previousDecision` is the queue-drain decision (`end` when no steering queued).
  Re-verified against agent-loop source. F5, D2, §5 row rewritten.
- **Q4 (accepted, no change):** secondmate independently concluded writes should not
  reset the append window.
- **Q3 (adopted):** history checkpoint phrasing with turn-index marker +
  "authoritative state is maintained via the workpad tool" line.
- **§7 (adopted):** `scheduled:N` as isolating control (cadence vs. persistence
  attribution). Hypothesis text must name this.
- **R6 note (adopted):** sheet growth → compaction → forced-append self-amplification;
  bounded, documented. T10 added.
- **Framing correction (adopted, 2026-09-16 evening):** user clarified the primary goal
  is *memory/retention*, not cache. The mode is a **replacement** of the transient
  mechanism, not a fourth arm alongside. Sequencing: implement → measure → delete
  transient. §1, §3 (R1), §7 rewritten accordingly. "After editing a turn" = retro-edit
  / `context_edit` — rejected (R5, §5 last row): append-only, forward.
- **Gate-removal round (advisor + secondmate, 2026-09-16):** advisor flagged the
  §4.2 `sameSnapshot` change-gate as the highest-severity flaw — under the memory
  framing it appended a static goal once then let it sink, defeating R1. Gate removed;
  handler now re-appends every N turns whenever the snapshot has content. Secondmate
  (w2C:p2) confirmed the removal is correct (the gate optimized dedup — a cache concern —
  at the expense of recency — the goal) and added three follow-ups, all applied:
  (a) T2/T9/T10 rewritten from dedup to cadence semantics; (b) `lastPersisted` status
  made explicit (retained only as the stub prerequisite, else dead state); (c) Q5 added
  — delta-stub as a pre-planned, falsifiable fallback, not a step-1 build. Novelty-decay
  concern (identical blocks clustering) assessed as overstated: at N-turn spacing the
  recent window holds at most 1–2 consecutive duplicates, strictly less repetitive than
  the per-call transient that already worked as a steering mechanism.
- **Full-replacement agreement (secondmate, 2026-09-16):** secondmate (w2C:p2) agreed
  with the full plan to fully replace the transient "LLM-on-top" tail mechanism — the
  `turn_end` history-append becomes the sole injection mechanism at step 8 (transient
  machinery deleted, `history-scheduled` the only mode). Until then both mechanisms
  coexist so no model tier is blocked. This closes the last open adjudication; Q1/Q2
  ratified to their proposed defaults (yes / yes).
- **Final sign-off (secondmate, 2026-09-16):** after verifying the updated doc, secondmate
  confirmed the HARD-DELETE end-state at step 8 and explicitly DECLINED a conditional
  ("a permanent keep-both hatch would contradict the full-replacement rationale"). Its
  earlier objection was sequencing, never permanence — "measure first, then delete," which
  step 8 encodes. Two standing code reminders adopted: (1) Q3 checkpoint body MUST carry
  the self-ownership "never acknowledge/restate/quote" line (echo-induction guard, R2);
  (2) `history-scheduled:1` gets a README warning, not a code guard.
