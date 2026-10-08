# 2 · Requirements: user-pin-submit

## Overview

`/mini-self-org-user-pin-submit` is an **active** directive command. It sets
the user-pinned directive (identical persistence to `pin`) **and** immediately
triggers an agent turn by submitting the directive text as a user-role message.

This closes the gap where a standing guardrail had to be set via `pin` and then
a separate user prompt was needed to make the agent act on it.

## Commands

| Invocation | Action |
|---|---|
| `/mini-self-org-user-pin-submit <text>` | Validate, persist the directive, display the combined workpad, and immediately trigger an agent turn with the directive text. |
| `/mini-self-org-user-pin-submit` (no text) | If `ctx.hasUI`, open an interactive prompt (`ctx.ui.input`) to collect the directive text, then perform the same persist + display + trigger flow. If `!ctx.hasUI`, notify a usage error and do nothing. |

## Validation

Applied to the directive text (after trim):

| Rule | Behaviour on failure |
|---|---|
| Trimmed text must be non-empty | Notify `"Nothing to pin"` (or similar). No entry written, no turn triggered. |
| Trimmed text must be ≤ 300 characters | Notify a length-exceeded error with the limit. No entry written, no turn triggered. |
| Multiline text | Allowed after trim. Must not break the sheet header layout. |

## Semantics

1. **Persistence:** Identical to `pin`. Calls
   `pi.appendEntry(USER_PIN_CUSTOM_TYPE, { text, timestamp: Date.now() })`.
   The directive is stored as a `CustomEntry` in the session branch tree,
   excluded from model context, invisible to agent tools.
2. **Force re-injection:** Sets `forceNextAppend = true` (no-op in `never`
   mode). This ensures the unified sheet including the new directive is emitted
   on the next completed turn.
3. **Display:** Shows the combined workpad (User Directive + Agent Scratchpad)
   via `ctx.ui.notify`, same as `pin`.
4. **Immediate turn trigger:** Calls `pi.sendUserMessage` with the directive
   text as the user-role message, routing by session state (see below).

## Execution Routing

The turn is triggered **after** persistence succeeds:

| Session state | Call |
|---|---|
| Idle (`ctx.isIdle()` → `true`) | `pi.sendUserMessage(text, { expandPromptTemplates: false })` |
| Busy / streaming (`ctx.isIdle()` → `false`) | `pi.sendUserMessage(text, { deliverAs: "followUp" })` |

- `expandPromptTemplates: false` ensures the text is sent verbatim, not
  interpreted as a prompt template.
- `deliverAs: "followUp"` queues the message after the in-flight turn instead
  of racing it.

## Comparison: `pin` (passive) vs `pin-submit` (active)

| | `/mini-self-org-user-pin` (passive) | `/mini-self-org-user-pin-submit` (active) |
|---|---|---|
| **Intended use** | Standing constraint for future turns; user is mid-conversation or setting policy. | Standing constraint that should immediately drive the agent's next action. |
| **Turn triggering** | None. Directive takes effect on the next naturally-emitted sheet. | Immediate. `pi.sendUserMessage` fires right after persistence. |
| **Busy / session state** | Not relevant (no message sent). | Idle → direct send; busy → `deliverAs: "followUp"`. |
| **Persistence** | `pi.appendEntry(USER_PIN_CUSTOM_TYPE, …)` | Identical |
| **`forceNextAppend`** | Armed | Armed (same) |
| **Display** | Combined workpad via `ctx.ui.notify` | Identical |
| **Agent tool schema** | Unchanged | Unchanged |

The two commands are complementary: `pin` is "remind the agent of this
constraint going forward"; `pin-submit` is "adopt this constraint *and* start
working on it now."
