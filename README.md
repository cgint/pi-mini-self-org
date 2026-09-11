# pi-mini-self-org

A bounded Pi extension that gives one agent its own session workpad — durable steering state, request-local injection, human visibility as a side effect.

## Install

```sh
pi install https://github.com/cgint/pi-mini-self-org
```

## What it keeps

The `mini-self-org-workpad` tool (label: **Mini self-org workpad**) atomically replaces a complete snapshot containing `overallGoal`, `currentFocus`, `nextActions`, `blockers`, and `notes`.

`overallGoal` is the stable umbrella outcome for the current **session-local work thread**. `currentFocus` is the immediate bounded activity within it. A session may contain multiple work threads over time; neither field is project memory or cross-session planning. Set `currentFocus` to `null` to clear a finished focus while retaining its work thread. Clear every field only when the entire workpad no longer aids the session.

The workpad is the agent's **own scratchpad**: it steers the agent's next moves rather than reporting to an external audience. **Durability filter:** write only what is worth re-reading after ten more tool calls or a context compaction — anything already visible in the conversation, or stale by the next tool call, belongs in the conversation, not here. `notes` are durable steering context — active hypotheses, working decisions, constraints — not logs, status, or findings.

The `mini-self-org-history` tool (label: **Mini self-org focus history**) reads a bounded, newest-last timeline of this branch's past workpad snapshots (timestamps, which fields changed, cleared states), distinguishing overall-goal changes from focus changes. It is read-only and non-authoritative: a re-orientation aid, not project memory, not task tracking, and never a replacement for a workpad update.

It is not project memory, durable cross-session planning or task tracking, or an automatic state update.

## Use

Use the workpad at meaningful state boundaries. When the overall goal, current focus, plan, or blockers materially change, replace the complete snapshot before the next consequential action batch; do not update it ritualistically after every tool call.

**Exact tool names:** The registered tools are `mini-self-org-workpad` and `mini-self-org-history`. `workpad` is not an alias and is never callable. `nextActions`, `blockers`, and `notes` are arrays, not JSON-encoded array strings.

**Lists:** 1–3 items typical (max 5) for `nextActions` and `notes`; each item is limited to 300 characters. Updates exceeding five items are rejected, not truncated. `blockers` remains capped at two items.

**Confidence tags:** Prefix a note or blocker with `[unverified]`, `[verified]`, or `[research]` to label the confidence of a steering item — labels on plans and hypotheses, not an evidence log.

The model receives one request-local current block per request, framed as its own working scratchpad: steering state, not a record, with facts to be re-derived from the conversation and tools. It remains active until replaced or cleared.

Pi serializes this block as the newest `user`-role message and keeps it last, so without framing it reads as something the human just typed and gets echoed back. It is therefore labelled as the agent's own recalled state, not a message from the user, and instructed not to restate it — reinforced both as a `promptGuidelines` bullet in the system prompt and in the block header. Tool-name mechanics are deliberately **excluded** from the block and live only in the tool description and guidelines, so the block carries state alone and stays byte-identical while the snapshot is unchanged. The TUI renderer shows the normalized snapshot, while tool-result details persist active-branch recovery.

Current sessions use `mini-self-org-workpad`. Legacy `workpad` result snapshots remain readable only for recovery: their old `goal` is normalized to `currentFocus`, with `overallGoal: null`; this does not create a callable legacy alias.

## Session and privacy boundary

Snapshots are stored in Pi session tool-result details for active-branch recovery. They are session-local state, not external storage or shared project memory. Treat workpad content as session content and avoid placing secrets or unnecessary personal data in it. The focus history view is derived from these same details at read time — it adds no new storage.

## Commands

- `/mini-self-org` — read-only view of the current workpad.
- `/mini-self-org-history` — read-only view of the branch's focus history (past workpad snapshots).

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
