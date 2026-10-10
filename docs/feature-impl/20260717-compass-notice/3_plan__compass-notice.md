# Plan: TUI-only steering-notice

## Design (implemented)
The feature adds **only** a UI side-effect to the existing `turn_end`
injection handler. The agent's `entries` return value is untouched.

### Notice wording (one short line, no jargon)
The notice is a glance-able human note of what the agent now carries — not a
system event. It is built by `steeringNoticeText(snapshot, directive)`:
- **Pin (guardrail) leads**, then `goal`, `focus`, then list **counts**
  (`1 action` / `2 actions`, `1 blocker` / `2 blockers`). `notes` is omitted for space.
- Single string values are quoted and **truncated to 30 chars** with `…`.
- Only non-empty fields appear; joined with `·`.
- **Empty (no pad, no pin)** → `workpad cleared`.
- No `↻`/`✓` glyph, no `turn N`, no "compass"/"steering updated" jargon.

Examples:
```
pin "Be careful" · goal "Ship" · focus "Test focus" · 2 actions
goal "Ship" · focus "Test focus" · 1 action
2 actions · 1 blocker
workpad cleared
```

### Content-gating (the "only when it changed" gate)
- New helper `steeringContentKey(snapshot, directive)` returns
  `JSON.stringify([directive?.text ?? null, overallGoal, currentFocus,
  nextActions, blockers, notes])`.
  - **Excludes** the turn index and the post-compaction flag — both change on
    every tick and would defeat the gate.
  - **Includes** the pin text, so a pin-only change (pad fields identical) is
    a genuine content change.
- Session-view state `lastInjectedContentKey` (string, not persisted to the
  branch) holds the last injected key. A due sheet fires the notice only when
  the current key differs.

### "Cleared" notice (content → empty transition)
- Session-view state `lastHadSteeringContent` (boolean) records whether the
  last injected steering state had content.
- In the **nudge branch** (empty pad + no pin, which is where clear/unpin
  lands), if `lastHadSteeringContent` was true, fire the distinct
  `workpad cleared` line (via `steeringNoticeText`, which returns that string
  when there is no content and no pin) and reset the flag. This makes losing a
  guardrail non-silent, symmetric with the content-change case.
- A subsequent empty tick (still empty, no prior content) does **not** re-fire.

### Quiet-on-reload (dedup seeded in `reconstruct`)
- `reconstruct` (run on `session_start` / `session_tree`) seeds
  `lastInjectedContentKey = steeringContentKey(snapshot, userDirective)` and
  `lastHadSteeringContent = hasContent(snapshot) || userDirective !== null`.
- Consequence: a resume or branch-switch that re-injects the **same** steering
  state stays quiet — the notice is for genuine changes, not reloads. This is a
  deliberate design decision (restored state is the baseline, not a change).

### Why `ctx.ui.notify` (and not a `display:true` custom message)
- `ui.notify` is a **pure UI call**: in interactive mode it routes to
  `ui.showExtensionNotify` (the TUI status line, a single slot replaced by the
  next status — transient, not a chat entry); in `rpc` mode it emits an
  `extension_ui_request/notify` event; in `no-UI` it is a `noOp` no-op. It is
  **never** included in the LLM request or persisted.
- A second `display:true` custom message would (a) alter the `entries` array
  (breaking ~30 existing tests that assert `entries.length === 1`) and (b)
  persist a transcript entry the user did not ask for.

### Crash-safety
- The `turn_end` handler now receives `ctx` (pi guarantees non-null; a
  defensive `ctx.ui?.notify?.` optional-chain ensures a missing `ui` never
  breaks the essential sheet injection).

## Test coverage plan (implemented)
- Fires on first content injection.
- Silent on identical-content re-injection (dedup).
- Re-fires on a genuine content change.
- Silent on the empty-pad nudge.
- **Distinct "cleared" notice on content → empty**; no re-fire on subsequent
  empty ticks.
- **Agent-invisible**: `entries` length unchanged, `display:false`,
  `customType` unchanged.
- **Pin set / unpin within a session** (pin text part of the content key).
- **Quiet on reload**: `session_tree` seeding means an identical re-injection
  does not fire.
- **No-`ui` crash-safety**: `turn_end` with `ctx.ui` undefined still injects
  the sheet.

## Verification evidence
- `npm run precommit` (typecheck + vitest + audit) green: 106 tests pass
  (98 pre-existing, 0 churn + 8 new), 0 vulnerabilities.

## Known limitations / unverified
- **Mode asymmetry (by design, locked by a test):** the `compass cleared`
  notice only fires in modes where the empty-pad nudge branch runs (i.e. when a
  scheduled interval is enabled). In **pure `user-boundary` mode**, clearing the
  pad injects *nothing* (the nudge is a scheduled-only feature), so there is no
  injection to ride a notice on and the clear is silent. This is deliberate: the
  single source of truth is `injected -> notify`; a notice with no corresponding
  injection would break that invariant. A documentation test
  ("documents the mode asymmetry…") locks this so it is not accidentally "fixed"
  into firing-without-injection.
- **[unverified]** live TUI status-line rendering not observed in a real
  `pi -e` session (API path confirmed + unit-tested; the visual is not).
- The notice is a **transient status line** (replaced by the next status), not
  a permanent chat entry — by design.
