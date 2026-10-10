# Requirements: TUI-only steering-notice

## Problem
When the self-org steering sheet is injected into the agent's context on a
turn-boundary cadence (user-boundary and/or `scheduled:N`), the human sees
**nothing**. The human has no signal that "the agent's head now carries my
steering state / guardrail."

## Goal (verbatim, from user)
- Show a **TUI-only, one-line** message **whenever the self-org sheet is injected to the agent**,
  so the human is informed that the agent now carries the steering state / guardrail.
- The change must be **minimal**.
- The **agent sees NO change** (zero new prompt tokens; the existing sheet stays `display:false`).
- The line fires **on every sheet injection** — i.e. on every due turn that actually emits a
  steering sheet (pad content or active pin), matching the `user-boundary` / `scheduled:N`
  cadence. It is a "the agent is carrying this" ticker, **not** a content-change signal.
- The line does **NOT fire for the empty-pad nudge** (a nudge sheet is not steering content).
- **Visible to the human** in the TUI.
- The line should read like a **short human note, not a system event** — tell a little of the
  story, minimally, and surface the actual content: the **self-workpad** fields (goal / focus /
  actions / blockers / notes) and, when present, the **user-pin** guardrail. No insider-slang,
  no `turn N` jargon, no "compass" metaphor (that is the agent's internal term, not the user's).

## Wording contract (revised)
The notice is a plain one-liner that shows *what the agent now carries* in the user's own
vocabulary — no verb prefix, no jargon, no `turn N`, no `↻`/`✓` glyph. It is a short human note,
not a system event.
- **Fields:** the pin (guardrail) **leads**, then `goal`, `focus`, then list counts (`1 action` /
  `2 actions`, `1 blocker` / `2 blockers`). `notes` is omitted for space. Only non-empty fields
  appear; a pin, when present, is always surfaced (the guardrail is the most important thing to know).
- **Single-line guarantee:** each string field is truncated to 30 chars, and the *total* line is
  capped at 70 code-points — when the line would exceed that, lower-priority fields (focus, then
  list counts) are dropped, so it never wraps on an 80-column terminal.
- **No distinct "cleared" line:** when content → empty, the next due turn is the nudge branch
  (not a steering sheet), so the notice does **not** fire. The helper's empty-case return is a
  defensive guard, not a state the notice surfaces.
- Field values are quoted; list counts are bare (`2 actions`).

Examples (worst-case stays ≤ 70 chars):
```
pin "Be careful" · goal "Ship the MVP"            (pin + goal fit; focus/lists dropped when long)
goal "Ship" · focus "Test focus" · 1 action       (typical)
5 actions · 3 blockers                            (lists only)
```

## Non-goals
- Not a persistent / scrollable chat entry (a `display:true` custom message was considered and rejected — it pollutes the transcript and was not requested).
- Not a second sheet or any change to the agent's `entries` payload.
- Not a task tracker / progress bar (explicitly out of scope, per AGENTS.md).

## Acceptance criteria
1. On **every** due turn that emits a steering sheet (non-empty pad OR active pin) → one-line status showing the present steering content (pin-first, budgeted per the wording contract above). This fires on every `user-boundary` and every `scheduled:N` tick, even when the content is unchanged.
2. **No dedup by content:** re-injecting identical steering content on a later due turn **still** fires the line (it is a per-injection ticker, not a change signal).
3. On the **empty-pad nudge** branch (no pad, no pin) → **no** line (a nudge sheet is not steering content; the human is not told about an empty-state reminder).
4. On **clear/unpin** (content → empty): the next due turn emits the nudge sheet (not a steering sheet), so **no steering line** fires for it; the guardrail-loss is visible because the *next* sheet with content (if any) carries it. (If a pin is removed and no pad content remains, subsequent ticks are nudge-only → no line.)
5. On **session reload / branch-switch** that re-injects steering content → the line **does** fire (it is a real injection the human should see); this is consistent with the per-injection rule.
6. **Agent-invisible**: the `entries` array returned by `turn_end` is byte-identical to before this feature (still the single sheet entry, `display:false`). The notice is a pure `ctx.ui.notify` side-effect, which pi routes to the TUI status line (interactive), an RPC event (`rpc`), or a no-op (`no-UI`) — never into the LLM request.
7. **Crash-safe**: a missing `ui` (defensive; pi guarantees non-null) must never break the essential sheet injection.
8. **Wording**: no "compass" / "turn N" in the user-facing line; workpad + pin content surfaced when present; one line; single-line budget (≤70 code-points) preserved.

## Out-of-scope (rejected alternatives, with reason)
- **`display:true` custom message** — pollutes the persistent transcript; not requested; a status line is the minimal correct surface.
- **Notifying on the empty-pad nudge** — a nudge (no steering content) is not "the agent carries my steering"; it would flood the human with reminders to *set* state they have chosen not to set.
