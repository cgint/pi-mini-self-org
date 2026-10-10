# Requirements: TUI-only steering-notice

## Problem
When the self-org steering sheet is injected into the agent's context on a
turn-boundary cadence (user-boundary and/or `scheduled:N`), the human sees
**nothing**. The human has no signal that "the agent's head now carries my
steering state / guardrail."

## Goal (verbatim, from user)
- Show a **TUI-only, one-line** message when the self-org info is shown to the agent.
- The change must be **minimal**.
- The **agent sees NO change** (zero new prompt tokens; the existing sheet stays `display:false`).
- The line must **NOT fire on every tick** — only when the steering content **actually changed**.
- Specifically: **not** on redundant re-injection of identical content, and **not** for the empty-pad nudge.
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
- **Clear:** `workpad cleared` (content → empty; no summary, nothing left to show).
- Field values are quoted; list counts are bare (`2 actions`).

Examples (worst-case stays ≤ 70 chars):
```
pin "Be careful" · goal "Ship the MVP"            (pin + goal fit; focus/lists dropped when long)
goal "Ship" · focus "Test focus" · 1 action       (typical)
5 actions · 3 blockers                            (lists only)
workpad cleared                                   (empty)
```

## Non-goals
- Not a persistent / scrollable chat entry (a `display:true` custom message was considered and rejected — it pollutes the transcript and was not requested).
- Not a second sheet or any change to the agent's `entries` payload.
- Not a task tracker / progress bar (explicitly out of scope, per AGENTS.md).

## Acceptance criteria
1. On a due turn where the steering content is (non-empty pad OR active pin) **and** the content key differs from the last injected content → one-line status showing the present steering content (pin-first, budgeted per the wording contract above).
2. On a due turn with **identical** content key → **no** line (dedup by content, not by turn).
3. On the **empty-pad nudge** branch (no pad, no pin) → **no** "updated" line.
4. On **clear/unpin** transition (content → empty) → a distinct `workpad cleared` line (losing a guardrail is not silent). No re-fire on subsequent empty ticks.
5. On **session reload / branch-switch** that re-injects the same content → **no** spurious line (dedup seeded in `reconstruct`).
6. **Agent-invisible**: the `entries` array returned by `turn_end` is byte-identical to before this feature (still the single sheet entry, `display:false`). The notice is a pure `ctx.ui.notify` side-effect, which pi routes to the TUI status line (interactive), an RPC event (`rpc`), or a no-op (`no-UI`) — never into the LLM request.
7. **Crash-safe**: a missing `ui` (defensive; pi guarantees non-null) must never break the essential sheet injection.
8. **Wording**: no "compass" / "turn N" in the user-facing line; workpad + pin content surfaced when present; one line.

## Out-of-scope (rejected alternatives, with reason)
- **`display:true` custom message** — pollutes the persistent transcript; not requested; a status line is the minimal correct surface.
- **Notifying on every tick** — violates "not on every tick"; defeated the change-detection requirement.
