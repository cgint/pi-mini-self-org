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

## Design sketch — `src/mini-self-org.ts`

- add a `SYSTEM_FRAME` constant (static text)
- `pi.on("before_agent_start")` → return `{ systemPrompt: event.systemPrompt + "\n\n" + SYSTEM_FRAME }`
- rewrite `contextMessage()` to the first-person, state-only block
- add content-discipline bullets to the workpad tool `description` / `promptGuidelines`
- keep the filter-then-append logic in the `context` handler as is

Unchanged: tool schemas, `reconstructSnapshot`, `mini-self-org-history`, TUI renderers,
`/mini-self-org*` commands, `display: false`.

## Tests

- `before_agent_start` appends the frame to the incoming system prompt and does not discard
  another extension's modification
- the injected block contains the snapshot fields and no tool-mechanics text
- exactly one workpad block survives the `context` handler, and it is the last message
- existing suite stays green: `npm run test`, `npm run typecheck`

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

**Still open:**
- Measured cache effect (see below) — the only substantive unknown left.
- Independent review by a second agent, requested by the user; findings to be reconciled here.
- The installed copy in `~/.pi/agent/git/...` predates `82d1e6d`, so no live session shows the new
  wording yet. Not touched deliberately: that is harness state, not repo state, and refreshing it should be
  the user's decision.

## Runtime caveat: this session is not running the committed wording

`~/.pi/settings` loads the extension from the git source, resolved to
`~/.pi/agent/git/github.com/cgint/pi-mini-self-org`, and that installed copy contains **0** matches for
the new header — it predates `82d1e6d`. Sessions therefore keep injecting the old
"Session-local, non-authoritative…" text. **Do not evaluate the reframing's effect until that copy is
updated and the session restarted**; a live session showing the old text is expected, not a regression.


- `Unverified:` cache reasoning is now mechanism-agreed but still unmeasured. Prefix caching matches
  the longest common prefix from token 0; a volatile **tail** diverges only at the very end, so prior
  history is reused and the extra cost is re-evaluating the block itself (tens of tokens, rounded to the
  engine's chunk granularity — 20 tokens on Anthropic). A **mid-transcript** insert diverges early and
  forfeits everything after it. Still to confirm with real cache read/write token counts.
- `Verified instead of required:` the `before_agent_start` byte-identical concern is moot now that D1
  ships through `promptGuidelines`; pi owns that prefix and it changes only when the active tool set
  changes. The cache breakpoint on the system block (`anthropic-messages.js:800-827`) is why hand-
  mutating that prefix was the wrong route.
- `Risk:` state in a `user`-role slot may still be echoed by some models despite the dual framing. If it
  persists in live sessions, the next lever is an explicit delimiter tag around the block; role and
  position are not available levers (D3).
- `Consequence:` the injection is free of context cost, but every **write** is permanent history — one
  sampled session carried 50 workpad tool calls plus 50 results. Context pressure is therefore driven by
  write frequency, which strengthens D4. It also means `reconstructSnapshot` and `mini-self-org-history`
  depend on those tool results surviving compaction; if they are pruned, the live snapshot has no durable
  source at all.
- `Out of scope:` compaction. The block is request-local and never reaches the compaction summary
  (`convertToLlm` runs there without `transformContext`), so post-compaction recovery still depends
  on `mini-self-org-history`. Touched by neither this plan's problem nor its fix.
- `Follow-up:` record the user-role injection and this framing decision in `docs/` — it is a
  non-obvious property of the design and is currently written down nowhere.
