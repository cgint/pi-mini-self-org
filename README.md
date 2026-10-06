# pi-mini-self-org

A bounded Pi extension that gives one agent its own session workpad — durable steering state, request-local injection, human visibility as a side effect.

## Install

```sh
pi install https://github.com/cgint/pi-mini-self-org
```

## What it keeps

The `self-org-workpad-set` tool (label: **Mini self-org workpad**) atomically replaces a complete snapshot containing `overallGoal`, `currentFocus`, `nextActions`, `blockers`, and `notes`.

`overallGoal` is the stable umbrella outcome for the current **session-local work thread**. `currentFocus` is the immediate bounded activity within it. A session may contain multiple work threads over time; neither field is project memory or cross-session planning. Set `currentFocus` to `null` to clear a finished focus while retaining its work thread. Clear every field only when the entire workpad no longer aids the session.

The workpad is the agent's **own scratchpad**: it steers the agent's next moves rather than reporting to an external audience. **Durability filter:** write only what is worth re-reading after ten more tool calls or a context compaction — anything already visible in the conversation, or stale by the next tool call, belongs in the conversation, not here. `notes` are durable steering context — active hypotheses, working decisions, constraints — not logs, status, or findings.

The `self-org-workpad-get` tool (label: **Mini self-org workpad (read)**) returns the current session-local workpad snapshot on demand. It is read-only: it performs no writes and does not change the workpad’s injection cadence.

The `self-org-workpad-history` tool (label: **Mini self-org focus history**) reads a bounded, newest-last timeline of this branch's past workpad snapshots (timestamps, which fields changed, cleared states), distinguishing overall-goal changes from focus changes. It is read-only and non-authoritative: a re-orientation aid, not project memory, not task tracking, and never a replacement for a workpad update.

It is not project memory, durable cross-session planning or task tracking, or an automatic state update.

## Use

Use the workpad at meaningful state boundaries. When the overall goal, current focus, plan, or blockers materially change, replace the complete snapshot before the next consequential action batch; do not update it ritualistically after every tool call.

**Exact tool names:** The registered tools are `self-org-workpad-set`, `self-org-workpad-get`, and `self-org-workpad-history`. `workpad` is not an alias and is never callable. `nextActions`, `blockers`, and `notes` are arrays, not JSON-encoded array strings.

**Lists:** 1–3 items typical (max 5) for `nextActions` and `notes`; each item is limited to 300 characters. Updates exceeding five items are rejected, not truncated. `blockers` remains capped at two items.

**Confidence tags:** Prefix a note or blocker with `[unverified]`, `[verified]`, or `[research]` to label the confidence of a steering item — labels on plans and hypotheses, not an evidence log.

The model receives periodic history-checkpoint sheets (persistent, appended at `turn_end`) framed as its own working scratchpad: steering state, not a record, with facts to be re-derived from the conversation and tools. They remain in the transcript until superseded by the next sheet.

### Injection policy

`MINI_SELF_ORG_INJECTION` is parsed when the extension initializes. Set it in the environment that starts the Pi session (e.g. your profile's shell profile or env settings) before the extension initializes. The only injection mechanism is a **persistent** append at `turn_end` (a `custom_message` entry in the session transcript); the `context` hook is **strip-only** and never injects. Its exact values are:

- `never` (the default when unset; `off` is an alias) — never inject the workpad into LLM context; the LLM accesses workpad state only via its tools (`self-org-workpad-set` to update, `self-org-workpad-get` to read, and `self-org-workpad-history` to recall past snapshots).
- `user-boundary` — persistent: append on the first completed turn after each user-submitted agent loop.
- `user-boundary+scheduled:<N>` — composite (order-insensitive; `history-scheduled:<N>` is accepted as the second token too): enables **both** triggers independently. A sheet is appended on the first completed turn after each user loop **or** every `N` completed turns (or forced by compaction/startup/branch switch), whichever fires first; if both are due on the same turn, exactly one sheet is emitted. A boundary-only sheet does not reset the scheduled cadence; a scheduled emission (or forced emission) does.
- `scheduled:<N>` — persistent: append a sheet every `N` completed `turn_end` events (a turn being a `turn_end` event with outcome `completed`). The window ticks on every completed turn, including empty-workpad turns; when the workpad is empty the boundary appends a short **nudge sheet** reminding the agent to set steering state via `self-org-workpad-set`. `scheduled:1` appends a sheet on every completed turn.
- `history-scheduled:<N>` — **aliased** to `scheduled:<N>` (lossless rename — same mechanism, new name; no warning).
- `always` — **no longer accepted.** It **warns** and falls back to `never` (not a hard throw — a hard throw would kill the entire extension, including tools, on upgrade). The warning names the migration path: use `scheduled:1` for per-turn or `scheduled:N` for per-`N`-turns.

Any other non-empty value is rejected during initialization. This includes composite values with `never`/`off`/`always`, duplicate triggers (`user-boundary+user-boundary`, `scheduled:2+scheduled:3`), missing tokens, malformed intervals, whitespace, or unknown tokens. In `user-boundary` and `scheduled:<N>` (alone or combined), the first completed turn after session start/resume, tree navigation, or a successful compaction also appends a sheet (resume/branch-switch is a boundary crossing; compaction forces one sheet). Empty workpads append a nudge sheet only when a scheduled trigger (or force) is due in `scheduled:<N>` or composite mode (never in pure `user-boundary`); a pending boundary survives an empty-pad nudge and emits on the next completed turn with a non-empty pad. Even in `never` mode, stale workpad custom messages are stripped on every request. Autonomous tool loops therefore receive a sheet at most once per user loop (`user-boundary`), at their configured `scheduled:<N>` cadence, or the coalesced minimum of both (composite). In `scheduled:<N>`, the sheet reflects the snapshot as of the last append, so it can be up to `N` turns stale; a static workpad is re-appended every `N` turns, not sunk — the goal is recall and retention, not deduplication. A workpad write does not reset the `N`-turn window; cadence is governed by the turn counter, not by writes. Aborted or errored turns are not counted; only `completed` turns advance the counter.

> **Note (migration):** `history-scheduled:<N>` is an alias for `scheduled:<N>` (lossless rename — same mechanism, new name). Set `scheduled:<N>` directly; the alias exists so existing `history-scheduled:<N>` configurations keep working without a warning.

The two persistent injection triggers — `user-boundary` and `scheduled:<N>` (with its alias `history-scheduled:<N>`) — may be enabled independently or combined via the `+` composite, plus `off`/`never`. Any other non-empty value is rejected during initialization. Empty workpads append a nudge sheet only when a scheduled trigger (or force) is due, and stale workpad custom messages are stripped on every request even when injection is suppressed. The context hook is strip-only (no injection path); all injection happens at `turn_end`.

Pi projects history-checkpoint sheets as `user`-role messages in the LLM transcript, so without framing they read as something the human just typed and get echoed back. They are therefore labelled as the agent's own recalled state, not a message from the user, and instructed not to restate it — reinforced both as a `promptGuidelines` bullet in the system prompt and in the sheet header. The sheet carries the snapshot plus fixed framing lines and a turn-index marker, so a sheet is stable for a given snapshot-and-turn-index but not byte-identical across appends. The TUI renderer shows the normalized snapshot, while tool-result details persist active-branch recovery.

Current sessions use `self-org-workpad-set`. Historical `mini-self-org-workpad` result snapshots already use the current `overallGoal`/`currentFocus` shape; legacy `workpad` result snapshots with an old `goal` are normalized to `currentFocus`, with `overallGoal: null`. Both remain readable only for recovery; this does not create a callable legacy alias.

## Session and privacy boundary

Snapshots are stored in Pi session tool-result details for active-branch recovery. They are session-local state, not external storage or shared project memory. Treat workpad content as session content and avoid placing secrets or unnecessary personal data in it. The focus history view is derived from these same details at read time — it adds no new storage.

## Commands

- `/mini-self-org` — read-only view of the current workpad (combined view if a directive is active).
- `/mini-self-org-user-pin <text>` — set a **User-Pinned Directive** (max 300 chars). Pinned directives are human-owned, immutable to the agent, and injected into every workpad sheet alongside the agent's scratchpad. They survive agent `self-org-workpad-set` overwrites and clears. With no argument and interactive UI, opens a prompt.
- `/mini-self-org-user-unpin` — clear the active directive.
- `/mini-self-org-history` — read-only view of the branch's focus history (past workpad snapshots).

The directive does not create a new injection trigger: it rides the existing injection cadence. A successful pin or unpin forces one immediate re-injection on the next completed turn (persistent modes only; no-op in `never` mode).

## Development

```sh
npm install
npm run typecheck
npm test
npm run precommit
```

For an interactive check:

```sh
pi -e ./index.ts
```
