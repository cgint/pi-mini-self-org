# Requirements: TUI-only compass-notice

## Problem
When the self-org steering sheet is injected into the agent's context on a
turn-boundary cadence (user-boundary and/or `scheduled:N`), the human sees
**nothing**. The human has no signal that "the agent's head now carries my
compass / guardrail."

## Goal (verbatim, from user)
- Show a **TUI-only, one-line** message when the self-org info is shown to the agent.
- The change must be **minimal**.
- The **agent sees NO change** (zero new prompt tokens; the existing sheet stays `display:false`).
- The line must **NOT fire on every tick** — only when the steering content **actually changed**.
- Specifically: **not** on redundant re-injection of identical content, and **not** for the empty-pad nudge.
- **Visible to the human** in the TUI.

## Non-goals
- Not a persistent / scrollable chat entry (a `display:true` custom message was considered and rejected — it pollutes the transcript and was not requested).
- Not a second sheet or any change to the agent's `entries` payload.
- Not a task tracker / progress bar (explicitly out of scope, per AGENTS.md).

## Acceptance criteria
1. On a due turn where the steering content is (non-empty pad OR active pin) **and** the content key differs from the last injected content → one-line status `↻ compass updated (turn N)`.
2. On a due turn with **identical** content key → **no** line (dedup by content, not by turn).
3. On the **empty-pad nudge** branch (no pad, no pin) → **no** "updated" line.
4. On **clear/unpin** transition (content → empty) → a distinct `✓ compass cleared (turn N)` line (losing a guardrail is not silent). No re-fire on subsequent empty ticks.
5. On **session reload / branch-switch** that re-injects the same content → **no** spurious line (dedup seeded in `reconstruct`).
6. **Agent-invisible**: the `entries` array returned by `turn_end` is byte-identical to before this feature (still the single sheet entry, `display:false`). The notice is a pure `ctx.ui.notify` side-effect, which pi routes to the TUI status line (interactive), an RPC event (`rpc`), or a no-op (`no-UI`) — never into the LLM request.
7. **Crash-safe**: a missing `ui` (defensive; pi guarantees non-null) must never break the essential sheet injection.

## Out-of-scope (rejected alternatives, with reason)
- **`display:true` custom message** — pollutes the persistent transcript; not requested; a status line is the minimal correct surface.
- **Notifying on every tick** — violates "not on every tick"; defeated the change-detection requirement.
