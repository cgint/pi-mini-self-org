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
- **Single-line budget:** the *total* line is capped at **70 code-points**; when it would exceed
  that, lower-priority fields (focus, then list counts) are dropped, so it never wraps on an
  80-column terminal. (Measured: a typical line is ~38 chars; the worst case degrades to the pin
  alone at ~36 chars.)
- Only non-empty fields appear; joined with `·`.
- **No distinct "cleared" line:** the empty-pad nudge branch does not fire the notice (a nudge is
  not steering content). The helper's empty-case return is a defensive guard, not a surfaced state.
- No `↻`/`✓` glyph, no `turn N`, no "compass"/"steering updated" jargon.

Examples:
```
pin "Be careful" · goal "Ship the MVP"            (pin + goal fit; focus/lists dropped when long)
2 actions · 1 blocker                              (lists only, no goal/focus)
goal "Ship" · focus "Test focus" · 1 action        (typical, fits under budget)
```

### Per-injection firing (no content dedup)
- The notice fires **on every due turn that emits a steering sheet** — i.e. inside
  the `turn_end` branch gated by
  `(hasContent(snapshot) || userDirective !== null) && (boundaryDue || scheduledDue || forceAppend)`.
  It calls `ctx.ui?.notify?.(steeringNoticeText(snapshot, userDirective), "info")`
  unconditionally, so the human sees a line each time the agent gets the sheet
  (every `user-boundary` and every `scheduled:N` tick), even when the content is
  unchanged. This is a "the agent is carrying this" ticker, **not** a change signal.
- There is **no** `steeringContentKey` / `lastInjectedContentKey` dedup and **no**
  `lastHadSteeringContent` "cleared" transition flag — those were removed with the
  content-change design.
- The **empty-pad nudge** branch (no pad, no pin) does **not** fire a notice — a
  nudge is not steering content, so the human is not told about an empty-state
  reminder. (If a pin is removed and no pad content remains, subsequent ticks are
  nudge-only → no line.)
- **Reload / branch-switch** that re-injects steering content **does** fire the
  notice (it is a real injection the human should see); consistent with the
  per-injection rule, no special seeding is needed.

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

## Test coverage plan (per-injection)
- **Fires on every sheet injection:** consecutive due turns with identical
  steering content each fire the line (the ticker), not just the first.
- **User-boundary + scheduled cadence:** with `scheduled:1`, the notice fires on
  every completed turn that emits a steering sheet.
- **Silent on the empty-pad nudge** (no pad, no pin) — zero notice calls on the
  nudge branch.
- **Pin-only sheet:** an active pin with an empty pad fires the line on every due
  turn (the guardrail is steering content the human is informed about).
- **Agent-invisible**: `entries` length unchanged, `display:false`,
  `customType` unchanged (byte-identical `entries` payload).
- **Single-line budget** preserved (≤70 code-points) on every fire.
- **No-`ui` crash-safety**: `turn_end` with `ctx.ui` undefined still injects
  the sheet.

## Verification evidence
- `npm run precommit` (typecheck + vitest + audit) green: 106 tests pass
  (98 pre-existing, 0 churn + 8 new), 0 vulnerabilities.

## Known limitations / unverified
- **Re-notification is intentional (user requirement):** with a live pin and
  `scheduled:N`, the line re-fires every `N` turns even when nothing changed —
  this is the "the agent still carries my guardrail" ticker the user asked for,
  not a bug. It is deliberately *not* deduped.
- **[OPEN — pending user decision] Pin re-blip vs the pin's "silent" requirement:**
  `docs/requirements-user-pin-emphasis-and-semantics.md` REQ-3.4 / AC-2 require the
  pin to be "silent adherence, no recital/chatter" — that rule governs the **agent's
  conversational output** (the agent must not recite the guardrail back to the user),
  which the notice does **not** affect (the notice is a pure `ui.notify` TUI status
  line; the agent's responses are unchanged). The remaining tension is only the
  *human-facing* blip: a live pin now re-blips every `scheduled:N` tick. This is the
  literal consequence of the user's "fire on every sheet injection" instruction, but
  it is **not yet adjudicated** in the pin-requirements doc. If the user wants the
  human-facing blip to *not* repeat for a pin-only (empty-pad) sheet, that is a
  small carve-out (suppress the notice when `userDirective !== null` &&
  `!hasContent(snapshot)`); it is a product decision, not a code defect.
- **[unverified]** live TUI status-line rendering not observed in a real
  `pi -e` session (API path confirmed + unit-tested; the visual is not).
- The notice is a **transient status line** (replaced by the next status), not
  a permanent chat entry — by design. pi's `showStatus` is idempotent (replaces in
  place), so repeating the blip does not fight TUI rendering; the only cost is
  stream-append noise.
