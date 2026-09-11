# 20260911_workpad-voice-and-frame_1_PLAN

Status: **planned, not implemented**. Writes were blocked while the problem was investigated, so no
code has changed. Evidence below was read from source, not assumed.

## Problem

Three observed symptoms of how the workpad currently reaches the model:

1. **"Alien information."** The injected block describes itself in detached third person
   ("Session-local, non-authoritative mini-self-org workpad"), so it reads as foreign content
   rather than the agent's own working state. Its targets feel external instead of self-owned.
2. **Echoing.** The agent sometimes restates the workpad back to the user. Because the block is
   serialized as a `user` message and is the newest message in the request, it looks like
   something the human supplied and ought to be acknowledged.
3. **Volatile content.** Short-lived status and transient facts get stored, turning a steering
   device into a fact-collection the context history already carries.

## Evidence (verified)

| Claim | Location |
| --- | --- |
| Workpad injected on every `context` event, appended last, `role: "custom"`, `display: false` | `src/mini-self-org.ts:305-318` |
| Context transform runs immediately before the LLM call | `pi-agent-core/dist/agent-loop.js:179-183` |
| `custom` → `role: "user"`; no other mapping exists for a context-injected message | `pi-coding-agent/dist/core/messages.js:89-96` (same in 0.84.4 and globally installed 0.85.1) |
| The user prompt is pushed into context **before** the transform, so the workpad lands **after** the user's real input | `pi-agent-core/dist/agent-loop.js:113-118` |
| `display: false` hides the block from the TUI only — `display` is never consulted when building the request | same `messages.js` branch |
| Anthropic cache breakpoints are **explicit and multiple**: system prompt (OAuth: two blocks; non-OAuth: the single system block), the last tool when supported, and the last block of the last `user`-role message | `pi-ai/dist/api/anthropic-messages.js:800-827` (system), `:1133` (tools), `:1066-1076` (last user block) |
| Because the system and tools prefixes carry their own breakpoints, a volatile tail cannot threaten them; losing only the history breakpoint costs the message history, not the whole request | same locations |
| A fabricated `toolResult` still serializes as `role: "user"` and needs a real `tool_use_id` | `anthropic-messages.js:1044-1062` |
| `before_agent_start` fires once per user prompt; `systemPrompt` is then fixed for the run | `agent-session.js:914`, `agent-loop.js:43-51` |
| `emitContext` clones the message array, so the injected block exists only for that one request and is never persisted | `pi-coding-agent/dist/core/extensions/runner.js:792` (`structuredClone`) |
| On real session data: 50 workpad tool calls + 50 tool results persisted, **0** injected blocks persisted; other extensions do persist custom entries (e.g. `pi-goal-state` x905), so transience is our choice, not a pi limit | `~/.pi/agent/sessions/--Users-cgint-dev-agent-coding-gui--/2026-08-30T12-02-37-198Z_01a0528c-*.jsonl` |

Empirical check against the installed build:

```
convertToLlm([ ..., {role:"custom", customType:"mini-self-org-workpad", display:false, ...} ])
→ { role:"user", content:[{type:"text", text:"Session-local, non-authoritative mini-self-org workpad."}] }
```

## Decisions

### D1 — Ownership belongs in the system prompt, delivered via `promptGuidelines` (superseded route: `before_agent_start`)

**Corrected during implementation.** The original mechanism here was a `before_agent_start` handler
appending a static frame to `event.systemPrompt`. That is unnecessary and worse:

- `promptGuidelines` of active tools are **already** rendered into the system prompt —
  `_rebuildSystemPrompt` collects them (`agent-session.js:741-749`) and `buildSystemPrompt` emits them
  as Guidelines bullets (`system-prompt.js:71-77`). The ownership framing therefore needs only another
  guideline bullet, which is pi-managed, scoped to the tool being active, and covered by the existing
  `promptGuidelines` test contract.
- `before_agent_start` fires once per **user prompt** (`agent-session.js:914`) and the system prompt is
  fixed for the run, so hand-managing it adds per-prompt re-stringing, a cache-broken prefix pi puts a
  breakpoint on, and a collision risk with other extensions editing the same string.

Shipped as `RECALL_GUIDANCE` in `promptGuidelines`: the trailing block is the agent's own recalled
state, not user input — never acknowledge, restate, or quote it; use it to steer the next action. The
volatile snapshot still never enters the system prompt: it would go stale mid-run (D3).

### D2 — The tail block keeps its position and role; only its voice changes

First-person, present tense, 3–5 short lines, no pi/tool mechanics:

```
My goal: …
My focus: …
Next: …
```

Mechanical guidance embedded in that block today (`TOOL_NAME_GUIDANCE`) moves out — it already
lives in the tool `description` and `promptGuidelines`, so right now it is paid for on every
request.

`D2a:` keep the block **byte-stable while the snapshot is unchanged**. Only `content` is serialized
to the provider (message `timestamp` is not), so the block text must not contain clocks, counters,
or turn numbers. When the text is identical, the block itself sits inside the reusable prefix and
costs nothing; a per-turn volatile byte makes the model re-read it on every call for no reason.

### D3 — Rejected: repositioning it, or changing its role

- **Insert before the last user message** (my earlier suggestion, retracted): on tool-loop turns
  the real user prompt sits deep in history, so this moves cache divergence into the middle of the
  tool log and re-writes it on every call.
- **`assistant`-role tail (prefill)**: reads as the agent's own voice, but `convertToLlm` passes it
  through unchanged, `convertMessages` then finds a non-user last message, and the **conversation
  history breakpoint disappears** — system and tool breakpoints survive, but the whole message
  history (the bulk of a long session) stops being cached. It also changes generation semantics
  (prefill), which is not a safe side effect for a state block.
- **Fabricated `toolResult`**: still `role: "user"` at provider level and requires a live
  `tool_use_id`. Buys nothing.
- **Snapshot in the system prompt only**: correct ownership, but `before_agent_start` is
  prompt-scoped, so mid-run updates stay invisible until the next user prompt — which defeats the
  tool's purpose.

### D4 — Curb volatility through the tool contract

Tighten `description` + `promptGuidelines`: the workpad steers (goal, focus, next actions,
blockers) and must not accumulate observations, command output, file lists, or per-step status;
items get dropped once done rather than appended to.

## Design sketch — as actually implemented in `8ab3870`

The original sketch (`SYSTEM_FRAME` + a `before_agent_start` handler + a first-person rewrite) was
**not** built. D1's route was superseded by `promptGuidelines`, and second-person wording had already
shipped in `82d1e6d`. What shipped instead:

- `RECALL_GUIDANCE` appended to the workpad tool's `promptGuidelines`
- `contextMessage()` header extended; `TOOL_NAME_GUIDANCE` removed from the block
- two test assertions added (byte-identical content; tool mechanics absent from the block)

Unchanged: tool schemas, `reconstructSnapshot`, `mini-self-org-history`, TUI renderers,
`/mini-self-org*` commands, `display: false`, injection point and position.

## Tests

Green as implemented: `npm run typecheck` clean, **21/21** passing; `cg-task.sh diff-review` returned no
defects.

- the injected block contains the snapshot fields and no tool-mechanics text
- exactly one workpad block survives the `context` handler, and it is the last message
- two `context` calls on an unchanged snapshot produce byte-identical content

Not yet written: a test that what reaches the model is **monotonic across requests** (Effect 2 below).
That property is untested and, given the transient block, currently false.

## Relation to `20260911_workpad-prompt-reframe_1_PLAN.md` (committed in `82d1e6d`)

Additive, not overlapping. That plan owns **prompt wording and content semantics**; this one owns the
**injection surface** — role, position, cache behaviour, and where the state is delivered. Neither
supersedes the other.

Shipped by `82d1e6d`: ownership framing in the injected header and tool description, the durability
filter, `notes` re-scoped to durable steering context, confidence tags re-labelled, update trigger
reworded to material change. That is this plan's **D4** plus most of **D2**'s intent.

**Superseded here:** D2's "rewrite to first person". The shipped wording is second person ("Your own
working scratchpad — steering state for this session, not a record"), which carries the same
ownership with less role confusion, and it is reviewed and test-pinned. Not re-litigated.

**Shipped by this plan (working tree, verified: typecheck clean, 21/21 tests):**
- `RECALL_GUIDANCE` added to `promptGuidelines` — ownership + "never acknowledge, restate, or quote it".
- `TOOL_NAME_GUIDANCE` removed from the injected block; it remains in the tool `description` and in
  `STALE_STATE_GUIDANCE`, so the mechanic is still stated where it belongs and the block is now state only.
- Block header states it is not a message from the user and must not be restated — the recency-layer half
  of echo mitigation, paired with the guideline bullet's policy layer.
- **D2a guard test** added: two `context` calls on an unchanged snapshot produce byte-identical content.
- Deliberate contract edit to the pinned injected-content assertion, plus a `not.toMatch` assertion that
  tool mechanics stay out of the block.
- README extended to describe the framing and the mechanics exclusion.

**Status after `8ab3870`, updated 2026-09-11:**
- Cache **read** side measured (below); the **write** side is not measurable from that data. What changed
  is the inference: monotonicity is no longer treated as a cost lever, so the unmeasured write side no
  longer gates candidate choice (see "Constraint under review").
- Independent review done: `cg-task.sh diff-review`, no defects.
- Behaviour of the framing is live, but **"observed improving" is retracted** — see "Runtime caveat —
  RESOLVED" and the corrected echo measurement below. The impression of improvement came from comparing two
  sessions that differ in more than the wording.
- The installed copy **is now a clean checkout of `8ab3870`**, verified by `git status --porcelain` empty
  and by the new strings present in that tree. The earlier note that it predated `82d1e6d` is
  **superseded**; refreshing that copy was correctly left to the user, and it has since been done.

## Duplication finding — supersedes the wording diagnosis

Measured in the installed `pi-ai` dist, 2026-09-11:

- `anthropic-messages.js:1028` serializes an assistant tool call as `{type:"tool_use", id, name,
  **input: block.arguments**}`. The snapshot the agent submits is therefore present in **every later
  request**, in the assistant's own voice, as its own past action.
- No `.details` reference exists in `anthropic-messages.js` or `openai-completions.js`, so tool-result
  `details` are never serialized. `execute()` content is only "Mini self-org workpad updated." — the
  model learns nothing about state from the result; it learns it from **what it typed itself**.

**Corrected claim:** an earlier note here and in the workpad said state "reaches the model only as
'workpad updated'" and that the snapshot is not serialized. **False.** The snapshot reaches the model
with perfect provenance — as its own tool-call input. Only the *result text* is empty.

**Consequence.** The request-local tail block therefore sends the same state a **second** time, in the
user's voice. Two copies, two contradictory roles. This is a better explanation of the alien-information
and echoing symptoms than wording was: trailing `user`-role content is read as an incoming instruction
to acknowledge. It also means every workpad write leaves another full snapshot in history, so a 50-write
session carries 50 snapshots plus one live tail copy.

### Constraint under review: "the cached prefix must be append-only" — downgraded from *governing*

The constraint was stated as: anything inside the cached prefix must be re-sent **identically or not at
all**, therefore the per-request tail block is a design fault whatever a provider does about it. As a
statement of tidiness that is true. As a **cost lever it is wrong**, and cost is what it was invoked to
protect.

Appending content does not invalidate what is already cached. Prefix growth is unavoidable in any
conversation and is priced once. The only real penalty is **re-reading content already sent**, and the
read-side data below shows the tail does not cause it.

**Measured cost, 2026-09-11** — session `2026-08-30T12-02-37-198Z_01a0528c-*.jsonl`, 7.93 MB across 1095
LLM messages; the only session among 910 with workpad activity:

| Element | n | median | total |
| --- | --- | --- | --- |
| `tool_use` args (full snapshot, permanent) | 33 | 652 B | 21,644 B |
| `toolResult` content | 50 | 60 B | 16,255 B |
| **All workpad content in the session** | | | **37,899 B = 0.48%** |

**`Retracted — this plan's own claim:`** "Context pressure is therefore driven by write frequency." Wrong
by roughly two orders of magnitude. Nothing in this design is large enough to threaten the bill, so cost
never justified eliminating any candidate. What remains real is **Effect 3's duplication**: one live copy
plus 33 permanent copies of substantially the same state.

**Verified mechanics relevant to any "cloak the marker" idea:**
- `cache_control` is stamped **unconditionally** on the last block of the last `user`-role message — no
  gate, no condition on volatility (`anthropic-messages.js:1067-1074`). Avoiding it requires payload
  surgery via `before_provider_request` (`types.d.ts:518-522` can replace the payload).
- Anthropic caps breakpoints (~4), and pi already uses system, tools and last-user. Relocating is a swap,
  not a removal.
- `ContextEvent` payload is `{ messages }` only (`types.d.ts:514-517`) — **no token or usage counts**.
  A token-displacement trigger must reach for `ctx.getContextUsage()`, whose `tokens` is documented null
  right after compaction (`types.d.ts:194`).
- pi fires **`session_compact`** *after* compaction succeeds, with `reason: "manual" | "threshold" |
  "overflow"` (`types.d.ts:453-461`). A hook at the moment context actually shrinks already exists.

**Candidates** (verdicts below were set by the constraint above and are **revised** by the measurement):
- **A** — status quo: full snapshot at the tail (what `8ab3870` ships). Formally non-monotonic; measured
  cost is the block's own size. **Not eliminated on cost grounds after all.**
- **B** — pointer tail: ≤3 lines instead of list bodies. A size trim, not a different shape; judged on
  cost it is merely a cheaper A.
- **C** — no tail at all; state lives only as the agent's own `tool_use` history. Gives up the property
  the feature exists for.
- **D — `DROPPED`, formerly recommended.** Its premise was that persisted writes are the expensive part.
  Measured 0.48% of session bytes; premise false. It also *increases* durable copies, which is the one
  cost the data does show.
- **E — recommended, replaces D.** Keep the sheet at the frontier; remove the duplication instead.
  Frontier recency is cheap and the byte-stability test from `8ab3870` means that between writes the
  sheet is identical text, so it is not a per-turn cost at all. The measured waste is the *permanent*
  duplicate: `tool_use` args carry the full snapshot on every write (`anthropic-messages.js:1028`).
  So: sheet stays (goal + focus + next, trimmed); write args slim; durable anchor becomes
  **event-driven** — on focus transition and on `session_compact` — rather than per write.

  **Implementation facts verified 2026-09-11, which reshape E:**
  - `details.snapshot` **does** persist — present on 33/33 workpad results, median 666 B, total 22,106 B
    (same session as the cost table). It is **never serialized** to the provider, so the durable store is
    already fully decoupled from what the model pays for.
  - `reconstructSnapshot` reads `message.details.snapshot` from `toolResult` entries
    (`src/mini-self-org.ts:106-117`), **not** the tool-call arguments. Slimming args therefore does *not*
    threaten reconstruction — the concern that had been recorded as a blocker is **disproved**.
  - **`The real blocker:`** `sanitizeSnapshot` requires all three lists to be present (`:72-75`), so there
    is **no partial-update semantics**. Today an agent that wants to change one field must re-send the
    whole snapshot — which is *why* every write carries a full copy. Arg-slimming first needs optional
    fields with merge semantics; that is a schema and validation change, not a wording change.
  - **`Verified — the earlier "untestable" note was my faulty scan:`** `details` **does** survive
    compaction *for reconstruction*, and the mechanism is structural rather than empirical.
    `reconstructSnapshot` calls `sessionManager.getBranch()` (`src/mini-self-org.ts:107`), and
    `getBranch` walks from the leaf to the root and **"includes all entry types"**, explicitly including
    `compaction` entries (`session-manager.js:953-966`). The summarised older entries are omitted only
    from **LLM context** (`buildContextEntries`, `:191-224`), never from the persisted branch the
    extension reads. So Effect 4 does not depend on the anchor at all.
    `Corrections:` (a) my "zero of 910 sessions have both compaction and workpad activity" was wrong — a
    correct scan finds **118** sessions with compaction and exactly 1 with both; (b) in that session all
    33 workpad results predate the later compactions, which is the *expected* consequence of the
    paragraph above, not a durability failure.

Prior art confirms both mechanisms exist and differ: a sibling extension in this environment holds
**905** TUI-only `custom` entries (never in LLM context) versus **46** LLM-visible `custom_message`
records — bulk state out, sparse durable events in.

`Decision pending from the user:` was originally "is a permanent frontier anchor required?" — **answered**
in favour of the sheet, on cost grounds now measured (the sheet is byte-stable between writes, so it is
not a per-turn cost). What is actually pending is E's one prerequisite: **accept the schema change to
partial updates**, since without merge semantics no arg-slimming is possible and the duplication is
structural rather than careless.

**Priced by the user, 2026-09-11:** cache integrity is paramount — "otherwise the bill will rise
enormously." That ruling stands and is respected; what changes is the estimate of what threatens it. The
ruling was recorded as *eliminating A and B*, and D as the survivor. **Both verdicts are withdrawn** —
they rested on monotonicity-as-cost, refuted by the measurement above. The ruling still condemns designs
that force re-reads; the tail does not do that.

The user's own framing of the goal, which the measurements support: *"the idea is to keep the LLM sane,
like a human being would have a sheet of paper with the most important points on the side while working
on something."* The sheet is not the problem; the 33 permanent photocopies of it inside past tool calls
are.

D's remaining argument — STALE_STATE_GUIDANCE makes the agent re-write at material shifts, so writes
*are* the frontier mechanism — is retained as the trigger for E's **durable** anchor, not as a reason to
remove the live sheet.

**No implementation has been agreed or started.** Source, tests and README are untouched since
`8ab3870`; only this plan has changed.

Rejected: synthesizing an `assistant` `toolCall` to anchor an injected `tool_result`. It fabricates an
action the agent never took, can suppress real updates by implying state was already saved, and is
message surgery that must survive every provider mapping.

Also surviving from the retracted claim below, independent of it: transient content must stay out of the
system prefix, and a mid-transcript insert diverges early, which is why the block stays appended last.

`Unverified:` whether models drop next-action execution once list bodies leave the tail — the
discriminator between C/D and A. Needs a session run on the new code, which needs the installed copy
refreshed.

## Retracted claim (recorded so it cannot resurface)

On 2026-09-11 I asserted in chat that pi's deepest cache checkpoint lands **on** the injected workpad
block, so every workpad write orphans it and forfeits message-history reuse — and I proposed moving the
checkpoint via `before_provider_request` payload surgery. **Not supported on the read side**, and the
surgery is rejected regardless: the fix for a non-monotonic prefix is to stop injecting transient content,
not to relocate a marker on top of it. Do not re-propose it without new evidence.

Still true from that analysis, and independent of the refutation: transient content must stay out of the
system prefix, and a **mid-transcript** insert would diverge early (pure prefix matching, no breakpoints
involved), which is why the block stays appended last.


## Runtime caveat — RESOLVED 2026-09-11: the new wording is now live

Previously this section recorded that the installed copy predated `82d1e6d`, so no session could show the
new framing. **Verified superseded:** `~/.pi/agent/git/github.com/cgint/pi-mini-self-org` is a clean
checkout of `8ab3870` — `git status --porcelain` empty, `RECALL_GUIDANCE` present at `src/mini-self-org.ts:20`,
new header at `:211`, and `TOOL_NAME_GUIDANCE` (`:19`) no longer in the injected block.

Sessions running after that refresh receive the new framing, and one was observed doing so. The tell-tale
of the old behaviour — a per-reply "acting on the block above, not answering it" preamble — was observed to
be less frequent. `Retracted:` that observation was impressionistic. A full scan of this project's sessions
(below) shows the preamble is **absent in every session before 2026-09-11 and heavy in two sessions on that
date, under both wordings**, so it tracks session length or compaction rather than the framing. Effect 1 is
**inconclusive**, not *improving* and not *met*.


- `MEASURED — and it refuted the claim:` the transient tail does **not** break incremental cache reuse.
  Sampled session, 50 requests immediately after a workpad write vs 428 ordinary follow-ups, compaction
  requests excluded: uncached input median **1122** after a write vs **1438** on ordinary follow-ups
  (mean 1417 vs 3040; max 13,812 vs 134,051), and `cacheRead` was non-decreasing in 47 of 49 consecutive
  post-write comparisons. An orphaned checkpoint would have shown post-write uncached input at full
  context size (~100k+); it never did. So a workpad write costs its own tokens and nothing else.
  `Hypothesis for the mechanism:` Anthropic resolves cache reads against the longest matching prefix at
  block granularity rather than strictly at the marked checkpoint, so a divergence confined to the tail
  costs only the tail. The measurement is verified; that explanation is not.
  `Caveat — stronger than first stated:` one session, one provider/model path, older pi build. The
  `cacheWrite: 0` column is **not** a lookup artifact — the field is real (`types.d.ts:269`, mapped from
  `cache_creation_input_tokens`) — yet it stays 0 while `cacheRead` passes 250k, so that build never
  populated it. Write-side amplification is **neither confirmed nor excluded**; only reads were measured.
  The append-only constraint stands on principle, not on this data.
- `Verified instead of required:` the `before_agent_start` byte-identical concern is moot now that D1
  ships through `promptGuidelines`; pi owns that prefix and it changes only when the active tool set
  changes. The cache breakpoint on the system block (`anthropic-messages.js:800-827`) is why hand-
  mutating that prefix was the wrong route.
- `Risk:` state in a `user`-role slot may still be echoed by some models despite the dual framing. If it
  persists in live sessions, the next lever is an explicit delimiter tag around the block; role and
  position are not available levers (D3).
- `Consequence — CORRECTED, the write-cost half retracted:` writes are permanent history, but measured
  small: 33 calls plus 50 results totalled 0.48% of a 7.93 MB session. "Context pressure is driven by
  write frequency" is **withdrawn**; D4 remains worth doing for signal quality, not to save cost. What
  stands in this bullet is the dependency: `reconstructSnapshot` and `mini-self-org-history` read those
  persisted results, so if they are pruned the snapshot loses its durable source — which is exactly why
  E slims write args only **after** confirming a durable source survives.
- `Compaction — durability is already satisfied.` The injected block never reaches the summary
  (`convertToLlm` runs there without `transformContext`). Inside the summarized region the snapshot
  degrades to prose (`compaction.js:497` summarizes via `convertToLlm` + `serializeConversation`), but
  durability never depended on model context: `reconstructSnapshot` and `mini-self-org-history` read the
  persisted branch, so state survives reload and compaction **today** with no frontier block. Effect 4 is
  therefore already met, and C/D cost nothing on durability.

## Decision brief — 2026-09-11 (decision-ready)

Written down at the user's request after the advisor reconciliation. This section is the current
position; the sections above record how it was arrived at, including the claims it overturns.

### Second perspective: external review — reconciled

| Advisor finding | Verdict | Basis |
| --- | --- | --- |
| Durable non-`user` needs a real `toolCall`/`toolResult`; synthetic ones add clutter | **Adopted** | Confirms the earlier rejection of fabricated `tool_use` |
| Message count *X* is a poor decay proxy; use token displacement | **Adopted, with a twist** | `ContextEvent` payload is `{ messages }` only (`types.d.ts:514-517`) — no usage data; a token trigger must reach for `ctx.getContextUsage()` |
| Check post-compaction re-injection **before** building cadence | **Adopted — decisive** | `session_compact` fires *after* compaction with `reason: manual\|threshold\|overflow` (`types.d.ts:453-461`). The hook exists; cadence rejected |
| Periodic insertion re-creates echoing risk | **Adopted** | Every fresh `user`-role restatement is another summarisation opportunity, permanently appended |

### Two claims of mine that fell

1. **"Writes are the real lever on your bill."** Wrong by roughly two orders of magnitude. In the only
   session with real activity (7.93 MB, 1095 LLM messages): 33 writes + 50 results = **37.9 KB = 0.48%**.
   Therefore **monotonicity is not a cost lever** — appending grows the bill once; the only real penalty is
   *re-reading*, and the read side shows no re-read cliff (median uncached **1,122** after a write vs
   **1,438** on ordinary turns). Consequence: **D is dropped**; **A and B were never rightly eliminated**.
2. **"Compaction survival is untestable — 0 of 910 sessions."** My scan was faulty. Corrected: **118**
   sessions contain compaction, **1** has both compaction and workpad activity. The question also has a
   structural answer: `reconstructSnapshot` calls `getBranch()`, which walks leaf→root and *"includes all
   entry types"* (`session-manager.js:953-966`). Summarised entries are omitted only from **LLM context**
   (`:191-224`), never from the branch the extension reads. **Effect 4 holds regardless of the anchor**,
   which makes the `session_compact` anchor optional rather than load-bearing.

### Shape that survives

Verified: `details.snapshot` persists on **33/33** results (median 666 B) and is **never serialized** to
the provider, so the durable store is already decoupled from what is paid for; `reconstructSnapshot` reads
*that*, not the args — slimming args is safe.

| Element | Decision | Why |
| --- | --- | --- |
| Live sheet at frontier | **Keep** | Byte-stable between writes → sits inside the cached prefix; it is the feature |
| `tool_call` args | **Slim** | Currently the *only* model-visible duplicate (`anthropic-messages.js:1028`) |
| `details.snapshot` | **Unchanged** | Durable, invisible to the provider, survives compaction |
| `session_compact` anchor | **Optional** | Durability already holds via `getBranch` |

### The genuine blocker, newly found

`sanitizeSnapshot` requires all three lists present (`src/mini-self-org.ts:72-75`) — **no partial-update
semantics**. Changing one field forces re-sending everything, which is *why* 33 near-identical copies
exist. The duplication is **structural, not careless**. Arg-slimming therefore needs optional fields plus
merge semantics first — a schema change, not a wording change.

### Ruling requested — `WITHDRAWN by the author, 2026-09-11`

The ruling asked for above ("E, with that schema change?") is **withdrawn and must not be implemented**.
It was requested before the one observable symptom had ever been measured. Both measurements now exist and
both point the other way:

- **Whether the framing reduces echoing is not established — the comparison I cited is confounded.** The
  strict signal is the acknowledgement tic ("acting on the block/state", "block above", "not answering it")
  in assistant text. Scanning *every* session in this project's directory, identical method throughout:

  | session | writes | tic / assistant-text | framing |
  | --- | --- | --- | --- |
  | `01a05752` 08-31 | 148 | 0 / 107 (0.0%) | old |
  | `01a06790` 09-03 | 37 | 0 / 51 (0.0%) | old |
  | `01a067a2` 09-03 | 9 | 0 / 2 (0.0%) | old |
  | `01a06bdb` 09-04 | 130 | 0 / 30 (0.0%) | old |
  | `01a08f14` 09-11 | 6 | 0 / 5 (0.0%) | old |
  | `01a08f1a` 09-11 | 64 | 70 / 87 (80.5%) | old |
  | `01a08f1d` 09-11 | 33 | 2 / 11 (18.2%) | new |
  | `01a08f56` 09-11 | 38 | 39 / 49 (79.6%) | new |

  The two sessions I compared (`01a08f1a` vs `01a08f56`) ran the **same model sets** and are the two longest
  sessions; four *older* sessions with up to 148 writes scored **0.0%** under the old wording. So the tic
  clusters by session, not by wording, and **"the framing had no measurable effect" overclaims in both
  directions** — it is inconclusive. `Unverified:` the actual driver (context saturation vs compaction
  summaries leaking self-narration).

- **The block does cause the tic — this part *is* established.** Control across all reachable sessions:
  workpad-active **112 / 3312 (3.4%)** versus workpad-absent **3 / 64613 (0.0%)**. An earlier note here
  claimed the tic was "largely the agent's own narration habit"; that is **retracted** — the baseline
  without the extension is effectively zero.
- **There is no cost to save.** All workpad content measured **0.48%** of a 7.93 MB session, with no
  read-side re-read cliff.
- **E carried a coupling nobody priced.** `tool_use` args are the model's *own* view of its state; slimming
  them removes the most trustworthy copy and leaves the injected sheet as the only one, which would likely
  *increase* state-narration rather than reduce it.

**Decision now: hold.** Source stays at `8ab3870`. Nothing about the injection, schema, or history is to be
changed on the present evidence.

**What would legitimately reopen this:**
- A **cost** signal, not a principle: a measured re-read cliff attributable to the block, or workpad bytes
  rising above ~1% of a session.
- A **behaviour** signal beyond the tic: state actually misremembered, stale goals acted on, or next actions
  dropped because list bodies left context.
- A reproducible reduction of the tic from a change tested the same way. Note that **natural sessions cannot
  settle framing efficacy** — the session-level clustering above swamps any wording effect. The measurement
  that would settle it is an **offline A/B replay**: the same long-context transcript, with only the
  framing text varied, on both models present here. Absent that, wording claims stay inconclusive.

### Still honestly open

- Anthropic's **write-side** cache counters were never populated in any build reachable for sampling.
- **Caused:** the acknowledgement tic is attributable to the injection (3.4% vs 0.0% control). **Not
  caused by wording,** and **unexplained** as to why it appears in only some sessions.
- Whether models drop next-action execution once list bodies leave context: never tested.
- `Method note:` session files record **schema `version: 3`**, not the pi release, so the build behind the
  cost sample cannot be identified from the data. Treat that sample as indicative, not current.

## Target effects (acceptance criteria)

The frame for choosing a delivery mechanism; outcomes, not mechanisms.

1. **Self-ownership, zero role dissonance** — state reads as the agent's own recall, never as an incoming
   instruction. *Accept:* no unprompted echo, summary, or acknowledgement in a real session.
   **Inconclusive, and `the earlier "improving" reading was wrong`.** The acknowledgement tic is caused by
   the injection (3.4% with the workpad active vs 0.0% without, across 2704 session files), but it does not
   track the wording: every session before 2026-09-11 scored 0.0% under the old wording, including one with
   148 writes, while two sessions on 2026-09-11 scored ~80% under old and new alike. Framing efficacy is
   therefore **unmeasured**, pending an offline A/B replay.
   This criterion is additionally **poorly specified**: as written it conflates "model echoes the block" with
   "model narrates what it is doing", and the latter is not a defect of this tool.
2. **No forced re-reads** *(re-framed from "strict cache-prefix monotonicity")* — the design must not make
   the provider re-read content already sent. Byte-stability while the snapshot is unchanged is still
   required, because it is what keeps the sheet off the per-turn bill. *Accept:* no re-read cliff attributable
   to the block. **Met on the read side; write side unmeasured.** The old wording made formal monotonicity
   itself the acceptance criterion, which measured as cost-free and so was the wrong target.
3. **Recency without duplication** — goal and focus stay steerable across 10+ turns without the same
   state travelling twice in two voices. *Accept:* frontier signal present, no full list bodies per minor
   step. **Duplication confirmed** at `anthropic-messages.js:1028`, but **harm is unmeasured**: it totals
   0.48% of a 7.93 MB session. So this is a real *inelegance* with no observed cost, and it is **not** a
   justification for changing the design — the state in `tool_use` args is also the model's honest view of
   its own prior action, which has independent value.
4. **Durability across reload and compaction** — material shifts reconstructible from durable records.
   **Met today**, independent of the injection.

**Trade-off — dissolved, and the remaining term shrank to nothing:** 2 and 3 were said to pull apart
because a permanent anchor was assumed to break cache reuse. It does not, measurably. Frontier recency can
come from the live sheet while durability comes from the persisted branch, which already survives
compaction via `getBranch`. The only term left standing was **duplication**, and at 0.48% of session bytes
it does not warrant the schema change E required — hence the hold recorded above.
- `Resolved — my error, not a defect:` a workpad call whose list field held a JSON string rather than an
  array rendered with stray brackets and quotes, and two blockers collapsed into one item. Re-issued with
  correctly formed arrays, it rendered clean. `sanitizeList` (which rejects non-arrays) behaved correctly;
  the malformed input was mine. No sanitizer bug exists.

- `Follow-up:` record the user-role injection and this framing decision in `docs/` — it is a
  non-obvious property of the design and is currently written down nowhere.

## Rejected: X-message cadence and periodic re-anchoring

Reconciled 2026-09-11 against a second perspective (advisor) that proposed re-asserting the snapshot
every *X* messages. Rejected, with its own reasoning adopted:

- **Message count is a poor proxy for decay.** Three large tool outputs can move tens of thousands of
  tokens; fifteen short commands move about a thousand. The proposed better trigger, token displacement,
  is awkward here for a verified reason: `ContextEvent` carries only `{ messages }` (`types.d.ts:514-517`).
- **The moment context actually shrinks already has an event.** `session_compact` fires after compaction
  with `reason: manual | threshold | overflow` (`types.d.ts:453-461`). Re-anchoring there addresses
  *state lost to summarisation* — the real "lost in noise" failure — instead of predicting decay.
- **Periodic insertion re-creates the echoing symptom.** Every fresh `user`-role restatement is another
  chance for the model to summarise it, undoing what `8ab3870`'s framing was for, and each echo is
  permanently appended.
- **Durable format constraint confirmed:** injected `custom` maps to `user` with no alternative, so the
  only valid non-`user` durable shape is a real `toolCall`/`toolResult` pair. A synthetic or timer-driven
  tool execution adds harness clutter and implies an action the agent never took — the same objection
  already recorded against fabricated `tool_use`.

**Not contradicted by this rejection:** the advisor's criterion that any re-anchor should key on context
reality rather than turn count. E honours it by using `session_compact` plus focus transition.
